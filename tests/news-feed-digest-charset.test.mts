/**
 * RSS bodies must be decoded with the encoding the publisher declared.
 *
 * `Response.text()` takes the charset from the `Content-Type` header only and
 * defaults to UTF-8; it never reads the XML prolog. Feeds that serve a legacy
 * encoding without a charset parameter therefore arrive as U+FFFD soup. Folha
 * de S.Paulo — added to the server digest catalog for the `pt` briefs — is
 * exactly that shape: `Content-Type: text/xml` over an `ISO-8859-1` body,
 * ~950 replacement characters per fetch, every accented Portuguese headline
 * mangled before the brief LLM ever sees it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decodeRssBody } from '../server/eagleeye/news/v1/list-feed-digest';

/** Encode a string as ISO-8859-1 bytes (each code point < 256 → one byte). */
function latin1Bytes(text: string): ArrayBuffer {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out.buffer;
}

const FOLHA_BODY = '<?xml version="1.0" encoding="ISO-8859-1" ?>\n'
  + '<rss version="0.91"><channel>'
  + '<item><title>Dólar abre em leve queda após o corte da Selic</title></item>'
  + '<item><title>JBS recebe aporte de US$ 2,5 bilhões de fundo soberano</title></item>'
  + '</channel></rss>';

describe('decodeRssBody', () => {
  it('honours an ISO-8859-1 prolog when the header carries no charset', () => {
    const text = decodeRssBody(latin1Bytes(FOLHA_BODY), 'text/xml');
    assert.match(text, /Dólar abre em leve queda/);
    assert.match(text, /US\$ 2,5 bilhões/);
    assert.equal(text.includes('�'), false, 'no replacement characters');
  });

  it('reproduces the bug when the prolog is ignored', () => {
    // Pins WHY the prolog read exists: the naive UTF-8 decode is what
    // Response.text() does, and it is lossy for this exact body.
    const naive = new TextDecoder('utf-8').decode(latin1Bytes(FOLHA_BODY));
    assert.ok(naive.includes('�'), 'baseline decode must be lossy');
    assert.doesNotMatch(naive, /Dólar/);
  });

  it('lets the Content-Type header win over the prolog', () => {
    // The header is the authoritative transport-level statement. A publisher
    // that transcodes to UTF-8 but forgets to update a cached prolog must not
    // be decoded as latin1 on the strength of the stale declaration.
    const utf8 = new TextEncoder().encode(FOLHA_BODY); // real bytes are UTF-8…
    const text = decodeRssBody(utf8.buffer as ArrayBuffer, 'text/xml; charset=utf-8');
    assert.match(text, /Dólar abre em leve queda/); // …despite the stale ISO-8859-1 prolog
    assert.equal(text.includes('�'), false);
  });

  it('defaults to UTF-8 when neither header nor prolog declares an encoding', () => {
    const body = '<rss version="2.0"><channel><title>Ünïcode</title></channel></rss>';
    const bytes = new TextEncoder().encode(body);
    assert.equal(decodeRssBody(bytes.buffer as ArrayBuffer, null), body);
    assert.equal(decodeRssBody(bytes.buffer as ArrayBuffer, 'application/xml'), body);
  });

  it('falls back to UTF-8 for an encoding label the runtime does not know', () => {
    // A feed we cannot name the encoding of is still better read optimistically
    // than dropped — TextDecoder throws on unknown labels, so this must not.
    const body = '<?xml version="1.0" encoding="x-made-up-9000" ?><rss version="2.0"/>';
    const bytes = new TextEncoder().encode(body);
    assert.equal(decodeRssBody(bytes.buffer as ArrayBuffer, 'text/xml'), body);
  });
});
