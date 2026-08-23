# frozen_string_literal: true

require_relative "lib/eagleeye/version"

Gem::Specification.new do |spec|
  spec.name = "eagleeye"
  spec.version = EagleEye::VERSION
  spec.summary = "Official Ruby SDK for the Eagle Eye global-intelligence API"
  spec.description = "Country briefs, risk scores, conflict/cyber/market/news feeds, and MCP tools " \
                     "from the Eagle Eye global-intelligence API without writing an HTTP " \
                     "integration. Stdlib-only (Net::HTTP), MCP-first — the same design as the " \
                     "official eagleeye npm CLI."
  spec.authors = ["Eagle Eye"]
  spec.license = "MIT"

  # The homepage is how agents (and agent-readiness scanners) verify this gem
  # is the product's official SDK — keep it on the product domain.
  spec.homepage = "https://eagle-eye.app"
  spec.metadata = {
    "homepage_uri" => "https://eagle-eye.app",
    "documentation_uri" => "https://www.eagle-eye.app/docs/sdks",
    "source_code_uri" => "https://github.com/hiatech/eagle-eye/tree/main/sdk/ruby",
    "bug_tracker_uri" => "https://github.com/hiatech/eagle-eye/issues",
    "rubygems_mfa_required" => "true",
  }

  spec.files = Dir["lib/**/*.rb"] + ["README.md", "LICENSE"]
  spec.require_paths = ["lib"]
  spec.required_ruby_version = ">= 2.6"
end
