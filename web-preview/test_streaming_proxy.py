"""Bounded SSE proxy checks; synthetic in-memory transports, no real sockets/AI."""
from io import BytesIO
import json
import unittest
from unittest.mock import patch

import httpx
import server
import test_server as base_tests

SESSION = "cd246ee3-f04a-44ce-a5aa-3e5975d82578"
PROJECT = "2d219451-5b71-4b59-b4bd-8bf716e218bd"
OPERATION = "cb233016-3f6d-4d25-bfb1-c93803cd8d07"
ACTION = "ca92deab-f768-4f58-bb60-d66f588941e2"
PATH = f"/api/v2/story-sessions/{SESSION}/text-messages"
OP = {"type":"operation", "operation_id":OPERATION, "project_id":PROJECT, "session_id":SESSION}
REPLY = {"type":"reply", "text":"Vad minns du från Malmö?"}
SAVE = {"type":"saving"}
DONE = {"type":"completed", "result":{"mode":"real", "synthetic":True}}
ERROR = {"type":"error", "status":504, "error":{"code":"AI_PROVIDER_TIMEOUT", "message":"Check the saved result."},
         "operation_id":OPERATION, "recovery":"check-saved", "retry_after":None}
HEADERS = [("Origin","http://127.0.0.1:8767"), ("Authorization","Bearer synthetic.user.token"),
           ("Content-Type","application/json"), ("Accept","text/event-stream"), ("Idempotency-Key",ACTION)]


def frame(event):
    return b"data: " + json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode() + b"\n\n"


class RecordedStream(httpx.SyncByteStream):
    def __init__(self, chunks):
        self.chunks = chunks
        self.closed = False
    def __iter__(self):
        yield from self.chunks
    def close(self):
        self.closed = True


class RecordingOutput(BytesIO):
    def __init__(self):
        super().__init__()
        self.flushed = []
    def flush(self):
        self.flushed.append(self.getvalue())
        super().flush()


class StreamingProxyTests(unittest.TestCase):
    setUp = base_tests.PreviewTests.setUp
    tearDown = base_tests.PreviewTests.tearDown
    use_transport = base_tests.PreviewTests.use_transport
    request = base_tests.PreviewTests.request

    def install(self, chunks, *, status=200, headers=None):
        stream = RecordedStream(chunks)
        self.received = []
        def callback(request):
            self.received.append(request)
            return httpx.Response(status, stream=stream, headers={
                "Content-Type":"text/event-stream; charset=utf-8", "X-Memy-Operation-Id":OPERATION,
                **(headers or {}),
            })
        self.use_transport(callback)
        return stream

    def call(self, path=PATH, method="POST", headers=HEADERS, output=None):
        return self.request(path, method, headers, b'{"text":"synthetic","language":"sv"}' if method=="POST" else b"", output=output)

    def test_opt_in_both_turn_routes_relay_with_security_headers_not_upstream_framing(self):
        for suffix in ("text-messages", "messages"):
            with self.subTest(suffix=suffix):
                stream = self.install([frame(OP),frame(REPLY),frame(SAVE),frame(DONE)], headers={
                    "Content-Length":"999999", "Transfer-Encoding":"chunked", "Set-Cookie":"never=share",
                    "Cache-Control":"public", "X-Accel-Buffering":"yes"})
                status, headers, body = self.call(path=f"/api/v2/story-sessions/{SESSION}/{suffix}")
                self.assertEqual(status,200)
                self.assertEqual(body,b"".join(map(frame,[OP,REPLY,SAVE,DONE])))
                self.assertEqual(headers["connection"],"close")
                self.assertNotIn("content-length",headers)
                self.assertNotIn("transfer-encoding",headers)
                self.assertNotIn("set-cookie",headers)
                self.assertEqual(headers["cache-control"],"no-store")
                self.assertEqual(headers["x-accel-buffering"],"no")
                self.assertEqual(headers["x-memy-operation-id"],OPERATION)
                self.assertEqual(headers["x-frame-options"],"DENY")
                self.assertIn("microphone=(self)",headers["permissions-policy"])
                self.assertIn("default-src 'none'",headers["content-security-policy"])
                self.assertTrue(stream.closed)

    def test_each_complete_frame_flushes_before_next_upstream_chunk_without_waiting_for_eof(self):
        output = RecordingOutput()
        def chunks():
            operation = frame(OP)
            yield operation[:12]
            self.assertFalse(any(operation in value for value in output.flushed))
            yield operation[12:]
            self.assertTrue(any(operation in value for value in output.flushed))
            reply = frame(REPLY)
            split = reply.index("ö".encode())+1
            yield reply[:split]
            self.assertFalse(any(reply in value for value in output.flushed))
            yield reply[split:]
            self.assertTrue(any(reply in value for value in output.flushed))
            yield frame(SAVE)
            self.assertTrue(any(frame(SAVE) in value for value in output.flushed))
            yield frame(DONE)
            self.fail("Do not wait for EOF after the terminal result")
        stream = self.install(chunks())
        status, _, body = self.call(output=output)
        self.assertEqual(status,200)
        self.assertTrue(body.endswith(frame(DONE)))
        self.assertTrue(stream.closed)

    def test_stream_requires_exact_post_route_accept_auth_key_and_status(self):
        cases = [("/api/v2/profiles","POST",HEADERS,200),
                 (PATH+"?limit=1","POST",HEADERS,200),
                 (PATH.replace(SESSION,SESSION.upper()),"POST",HEADERS,200),
                 (PATH,"GET",HEADERS,200),(PATH,"PATCH",HEADERS,200),
                 (PATH,"POST",[(k,v) for k,v in HEADERS if k!="Accept"],200),
                 (PATH,"POST",[(k,"text/event-stream, application/json" if k=="Accept" else v) for k,v in HEADERS],200),
                 (PATH,"POST",[(k,v) for k,v in HEADERS if k!="Authorization"],200),
                 (PATH,"POST",[(k,v) for k,v in HEADERS if k!="Idempotency-Key"],200),
                 (PATH,"POST",HEADERS,201)]
        for path,method,headers,status in cases:
            with self.subTest(path=path,method=method,headers=headers,status=status):
                stream = self.install([frame(OP)],status=status)
                result,response_headers,body = self.call(path,method,headers)
                self.assertEqual(result,502)
                self.assertEqual(json.loads(body)["error"]["code"],"PREVIEW_BACKEND_RESPONSE_INVALID")
                self.assertTrue(stream.closed)

    def test_bad_origin_or_duplicate_auth_never_reaches_the_backend(self):
        for headers in [HEADERS+[("Authorization","Bearer another.user")],
                        [(k,"https://evil.invalid" if k=="Origin" else v) for k,v in HEADERS]]:
            stream = self.install([frame(OP)])
            status,_,_ = self.call(headers=headers)
            self.assertIn(status,(400,403))
            self.assertEqual(self.received,[])

    def test_invalid_first_frames_and_header_fail_before_event_stream_headers(self):
        bad = [b": heartbeat\n\n",b"event: provider.raw\ndata: {}\n\n",b"data: []\n\n",
               b"data: {\"type\":\"operation\",\"type\":\"operation\"}\n\n",
               b"data: {\"type\":NaN}\n\n",b"data: \xff\n\n",frame(REPLY),
               frame({**OP,"session_id":PROJECT}),frame({**OP,"operation_id":"not-an-id"}),
               frame({**OP,"operation_id":PROJECT}),frame({**OP,"extra":"never-return"})]
        for data in bad:
            with self.subTest(data=data[:60]):
                stream=self.install([data])
                status,headers,body=self.call()
                self.assertEqual(status,502)
                self.assertIn("application/json",headers["content-type"])
                self.assertNotIn(b"never-return",body)
                self.assertTrue(stream.closed)
        for header in ["bad",SESSION.upper(),OPERATION+", "+OPERATION]:
            stream=self.install([frame(OP)],headers={"X-Memy-Operation-Id":header})
            self.assertEqual(self.call()[0],502)
            self.assertTrue(stream.closed)

    def test_invalid_later_frame_closes_without_a_second_json_response(self):
        bad=[b"data: broken-secret\n\n",frame(OP),frame({**REPLY,"text":""}),
             frame({**REPLY,"text":"x"*1001}),b'data: {"type":"reply","text":"\\ud800"}\n\n',
             frame({**ERROR,"operation_id":PROJECT}),frame({**ERROR,"recovery":"automatically-retry"}),frame({**ERROR,"recovery":[]}),
             frame({"type":"response.output_text.delta","delta":"never-return"})]
        for data in bad:
            with self.subTest(data=data[:60]):
                stream=self.install([frame(OP),data])
                output=RecordingOutput()
                status,_,body=self.call(output=output)
                self.assertEqual(status,200)
                self.assertEqual(body,frame(OP))
                self.assertEqual(output.getvalue().count(b"HTTP/1.1"),1)
                self.assertNotIn(b"PREVIEW_BACKEND",body)
                self.assertTrue(stream.closed)

    def test_compressed_streams_are_not_decompressed_or_relayed(self):
        stream=self.install([b"compressed-bytes-never-relayed"],headers={"Content-Encoding":"gzip"})
        status,_,body=self.call()
        self.assertEqual(status,502)
        self.assertEqual(json.loads(body)["error"]["code"],"PREVIEW_BACKEND_RESPONSE_INVALID")
        self.assertTrue(stream.closed)

    def test_one_reply_and_saving_only_before_terminal(self):
        for events in [[OP,REPLY,REPLY,DONE],[OP,SAVE,REPLY,DONE],[OP,SAVE,SAVE,DONE]]:
            stream=self.install(list(map(frame,events)))
            status,_,body=self.call()
            self.assertEqual(status,200)
            self.assertNotIn(frame(DONE),body)
            self.assertTrue(stream.closed)

    def test_limits_apply_to_total_json_event_and_frame_count(self):
        operation=frame(OP)
        cases=[("MAX_STREAM_BYTES",len(operation)-1,[operation],502,b"PREVIEW_RESPONSE_TOO_LARGE"),
               ("MAX_STREAM_EVENT_BYTES",10,[operation],502,b"PREVIEW_RESPONSE_TOO_LARGE"),
               ("MAX_STREAM_EVENT_BYTES",10,[b"data: "+b"x"*11],502,b"PREVIEW_RESPONSE_TOO_LARGE"),
               ("MAX_STREAM_BYTES",len(operation)+1,[operation,frame(REPLY)],200,operation),
               ("MAX_STREAM_FRAMES",2,[operation,frame(REPLY),frame(SAVE),frame(DONE)],200,operation+frame(REPLY))]
        for name,bound,chunks,status,expected in cases:
            with self.subTest(name=name,bound=bound):
                stream=self.install(chunks)
                with patch.object(server,name,bound):
                    result,_,body=self.call()
                self.assertEqual(result,status)
                if result==200:self.assertEqual(body,expected)
                else:self.assertIn(expected,body)
                self.assertTrue(stream.closed)

    def test_error_events_keep_original_operation_and_recovery_without_retry(self):
        stream=self.install([frame(OP),frame(ERROR)])
        status,_,body=self.call()
        self.assertEqual(status,200)
        self.assertEqual(body,frame(OP)+frame(ERROR))
        self.assertEqual(len(self.received),1)
        self.assertTrue(stream.closed)

    def test_normal_json_preclaim_errors_and_completed_replays_stay_json(self):
        for status,payload in [(429,{"error":{"code":"AI_BUSY","message":"Wait."}}),
                               (200,{"mode":"real","replayed":True})]:
            received=[]
            def callback(request):
                received.append(request)
                return httpx.Response(status,json=payload,headers={"X-Memy-Recovery":"wait","Retry-After":"60"})
            self.use_transport(callback)
            result,headers,body=self.call()
            self.assertEqual(result,status)
            self.assertEqual(json.loads(body),payload)
            self.assertIn("application/json",headers["content-type"])
            self.assertEqual(headers["x-memy-recovery"],"wait")
            self.assertEqual(len(received),1)

    def test_disconnect_or_upstream_failure_closes_upstream_without_second_response(self):
        class DisconnectedOutput(RecordingOutput):
            def write(self,data):
                if data.startswith(b"data: "):raise BrokenPipeError("synthetic disconnected browser")
                return super().write(data)
        stream=self.install([frame(OP),frame(REPLY)])
        output=DisconnectedOutput()
        status,_,body=self.call(output=output)
        self.assertEqual(status,200)
        self.assertEqual(body,b"")
        self.assertTrue(stream.closed)
        self.assertEqual(output.getvalue().count(b"HTTP/1.1"),1)
        def broken():
            yield frame(OP)
            raise httpx.ReadError("never-return")
        stream=self.install(broken())
        output=RecordingOutput()
        status,_,body=self.call(output=output)
        self.assertEqual(status,200)
        self.assertEqual(body,frame(OP))
        self.assertTrue(stream.closed)
        self.assertEqual(output.getvalue().count(b"HTTP/1.1"),1)

    def test_incomplete_eof_stays_incomplete_and_never_fabricates_success(self):
        stream=self.install([frame(OP),frame(REPLY)])
        status,_,body=self.call()
        self.assertEqual(status,200)
        self.assertEqual(body,frame(OP)+frame(REPLY))
        self.assertTrue(stream.closed)

    def test_streamed_requests_do_not_merge_shared_auth_or_cookies(self):
        for auth in ["Bearer synthetic.first.user","Bearer synthetic.second.user"]:
            stream=self.install([frame(OP),frame(DONE)],headers={"Set-Cookie":"never=shared"})
            self.client.headers["Authorization"]="Bearer never.default.auth"
            self.client.cookies.set("never","shared",domain="127.0.0.1")
            headers=[(key,auth if key=="Authorization" else value) for key,value in HEADERS]
            self.assertEqual(self.call(headers=headers)[0],200)
            sent=self.received[0]
            self.assertEqual(sent.headers["Authorization"],auth)
            self.assertNotIn("Cookie",sent.headers)
            self.assertTrue(stream.closed)


if __name__=="__main__":unittest.main()
