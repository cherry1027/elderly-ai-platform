"""Run the actual v2 app with existing private configuration and no mock providers.

Default binds loopback and forces paid providers off. Read the runbook before
explicitly enabling real AI or exposing a phone-accessible private-network port.
"""

import argparse
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BACKEND))


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file",action="append",type=Path,default=[],help="Existing private dotenv; repeat to overlay. Never copy keys into mobile files.")
    parser.add_argument("--enable-real-ai",action="store_true",help="Also requires REAL_AI_ENABLED=true and current private spending approval.")
    parser.add_argument("--host",choices=["127.0.0.1","0.0.0.0"],default="127.0.0.1")
    parser.add_argument("--trusted-private-network",action="store_true")
    parser.add_argument("--port",type=int,default=8001)
    parser.add_argument("--check",action="store_true",help="Print sanitized local status only; no HTTP or provider calls.")
    args=parser.parse_args(argv)
    if not 1024<=args.port<=65535 or (args.host=="0.0.0.0" and not args.trusted_private_network):
        parser.error("Use an unprivileged port; LAN hosting requires --trusted-private-network.")
    if any(not p.is_absolute() or not p.is_file() for p in args.env_file):
        parser.error("Use existing absolute private configuration paths.")
    try:
        from app.core.config import Settings
        from app.main import create_app
        configured=Settings(_env_file=tuple(args.env_file) if args.env_file else None)
        # The real launcher never starts the legacy fictional providers.
        config=configured.model_copy(update={"conversation_mode":"disabled","story_generation_mode":"disabled",
            "ai_provider_mode":"disabled","real_ai_enabled":bool(args.enable_real_ai and configured.real_ai_enabled)})
        app=create_app(config)
        status=app.state.real_ai.capabilities()
        if args.enable_real_ai and not status["enabled"]:
            print("Real AI could not be enabled; configuration and private approval require review.",file=sys.stderr)
            return 2
        if args.check:
            import json
            print(json.dumps({"supabase_configured":config.supabase_configured,
                "server_credential_present":bool(config.supabase_secret_key),"real_ai":status,
                "legacy_simulation_enabled":False}))
            return 0
        import uvicorn
        print("Memy real-v2 app. Paid providers: "+("explicitly approved" if status["enabled"] else "OFF"))
        uvicorn.run(app,host=args.host,port=args.port,access_log=False)
        return 0
    except Exception:
        print("Cannot start Memy. Check private configuration and installed dependencies; no secret details were logged.",file=sys.stderr)
        return 2


if __name__=="__main__":
    raise SystemExit(main())
