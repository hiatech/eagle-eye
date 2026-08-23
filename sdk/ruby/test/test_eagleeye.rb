# frozen_string_literal: true

# Offline tests for the eagleeye gem (fake transport, no network).
require "minitest/autorun"
require "json"
require_relative "../lib/eagleeye"

class FakeTransport
  attr_reader :requests

  def initialize(responses)
    @responses = responses.dup
    @requests = []
  end

  def call(request, timeout)
    @requests << [request, timeout]
    @responses.shift
  end
end

def json_response(payload, status = 200)
  [status, "application/json", JSON.generate(payload)]
end

def rpc_result(result)
  json_response({ "jsonrpc" => "2.0", "id" => 1, "result" => result })
end

class TestParseBody < Minitest::Test
  def test_plain_json
    assert_equal({ "a" => 1 }, EagleEye::Client.parse_body('{"a": 1}', "application/json"))
  end

  def test_sse_takes_last_data_line
    body = "event: message\ndata: {\"a\": 1}\n\nevent: message\ndata: {\"b\": 2}\n"
    assert_equal({ "b" => 2 }, EagleEye::Client.parse_body(body, "text/event-stream"))
  end

  def test_sse_detected_without_content_type
    assert_equal({ "ok" => true }, EagleEye::Client.parse_body("data: {\"ok\": true}\n"))
  end

  def test_non_json_falls_back_to_text
    assert_equal "plain text", EagleEye::Client.parse_body("plain text", "text/plain")
  end
end

class TestClientConfig < Minitest::Test
  def test_env_fallbacks
    env = { "EAGLEEYE_API_KEY" => "wm_env", "EAGLEEYE_BASE_URL" => "https://self.example/" }
    client = EagleEye::Client.new(env: env, transport: FakeTransport.new([]))
    assert_equal "wm_env", client.api_key
    assert_equal "https://self.example", client.base_url
    assert_equal EagleEye::DEFAULT_MCP_URL, client.mcp_url
  end

  def test_explicit_args_beat_env
    client = EagleEye::Client.new(api_key: "wm_arg", env: { "WM_API_KEY" => "wm_env" },
                                      transport: FakeTransport.new([]))
    assert_equal "wm_arg", client.api_key
  end

  def test_user_agent_carries_version
    assert_includes EagleEye::USER_AGENT, EagleEye::VERSION
    assert EagleEye::USER_AGENT.start_with?("eagleeye-ruby/")
    assert_includes EagleEye::USER_AGENT, "+https://eagle-eye.app"
  end
end

class TestMCPCalls < Minitest::Test
  def test_call_tool_builds_json_rpc_and_unwraps_result
    transport = FakeTransport.new([rpc_result({ "ok" => true })])
    client = EagleEye::Client.new(api_key: "wm_k", env: {}, transport: transport)
    assert_equal({ "ok" => true }, client.call_tool("get_country_risk", country_code: "IR"))

    request, timeout = transport.requests.first
    assert_equal EagleEye::DEFAULT_MCP_URL, request[:url]
    assert_equal "POST", request[:method]
    assert_equal "wm_k", request[:headers][EagleEye::API_KEY_HEADER]
    assert_equal EagleEye::USER_AGENT, request[:headers]["user-agent"]
    assert_includes request[:headers]["accept"], "text/event-stream"
    assert_equal client.timeout, timeout
    rpc = JSON.parse(request[:body])
    assert_equal "tools/call", rpc["method"]
    assert_equal({ "name" => "get_country_risk", "arguments" => { "country_code" => "IR" } }, rpc["params"])
  end

  def test_curated_helper_maps_to_tool
    transport = FakeTransport.new([rpc_result({})])
    EagleEye::Client.new(env: {}, transport: transport).country_risk("IR", jmespath: "scores")
    rpc = JSON.parse(transport.requests.first[0][:body])
    assert_equal "get_country_risk", rpc["params"]["name"]
    assert_equal({ "jmespath" => "scores", "country_code" => "IR" }, rpc["params"]["arguments"])
  end

  def test_list_tools_is_keyless
    transport = FakeTransport.new([rpc_result({ "tools" => [] })])
    result = EagleEye::Client.new(env: {}, transport: transport).list_tools
    assert_equal({ "tools" => [] }, result)
    request, = transport.requests.first
    refute_includes request[:headers], EagleEye::API_KEY_HEADER
    rpc = JSON.parse(request[:body])
    assert_equal "tools/list", rpc["method"]
    refute rpc.key?("params")
  end

  def test_mcp_error_raises_with_auth_hint
    transport = FakeTransport.new([json_response(
      { "jsonrpc" => "2.0", "id" => 1,
        "error" => { "code" => EagleEye::MCP_AUTH_ERROR_CODE, "message" => "auth required" } }
    )])
    err = assert_raises(EagleEye::MCPError) do
      EagleEye::Client.new(env: {}, transport: transport).world_brief
    end
    assert_equal EagleEye::MCP_AUTH_ERROR_CODE, err.code
    assert_includes err.message, "EAGLEEYE_API_KEY"
  end

  def test_mcp_error_wins_over_http_200
    transport = FakeTransport.new([json_response(
      { "jsonrpc" => "2.0", "id" => 1, "error" => { "code" => -32_602, "message" => "bad params" } }, 200
    )])
    assert_raises(EagleEye::MCPError) do
      EagleEye::Client.new(env: {}, transport: transport).call_tool("t")
    end
  end

  def test_sse_mcp_response_is_unwrapped
    body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"n\":1}}\n"
    transport = FakeTransport.new([[200, "text/event-stream", body]])
    assert_equal({ "n" => 1 }, EagleEye::Client.new(env: {}, transport: transport).call_tool("t"))
  end
end

class TestRest < Minitest::Test
  def test_get_builds_query_and_parses
    transport = FakeTransport.new([json_response({ "status" => "ok" })])
    client = EagleEye::Client.new(api_key: "wm_k", env: {}, transport: transport)
    assert_equal({ "status" => "ok" }, client.get("/api/health", verbose: true))
    request, = transport.requests.first
    assert_equal "#{EagleEye::DEFAULT_BASE_URL}/api/health?verbose=true", request[:url]
    assert_equal "wm_k", request[:headers][EagleEye::API_KEY_HEADER]
  end

  def test_get_requires_host_relative_path
    assert_raises(ArgumentError) do
      EagleEye::Client.new(env: {}, transport: FakeTransport.new([])).get("api/health")
    end
  end

  def test_non_2xx_raises_api_error
    transport = FakeTransport.new([json_response({ "error" => "unauthorized" }, 401)])
    err = assert_raises(EagleEye::APIError) do
      EagleEye::Client.new(env: {}, transport: transport).health
    end
    assert_equal 401, err.status
    assert_includes err.message, "EAGLEEYE_API_KEY"
  end
end
