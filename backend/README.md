# Memy AI backend

Python 3.13 is the verified development runtime. From the repository root:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs` for Swagger UI. Run
`curl -i http://127.0.0.1:8000/health` in another terminal. Expected: HTTP 200 and
`{"status":"ok","service":"memy-ai-backend"}`.

`GET /health` is public liveness and does not depend on Supabase. It does not
prove database connectivity. No AI, transcription, payments, or storage features
are implemented in this backend at Day 1.
