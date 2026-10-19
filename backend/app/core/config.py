from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import AliasChoices, AnyHttpUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
        populate_by_name=True,
        hide_input_in_errors=True,
    )

    supabase_url: AnyHttpUrl | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_URL", "VITE_SUPABASE_URL"),
    )
    supabase_publishable_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"
        ),
    )
    cors_origins: list[str] = [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    request_timeout_seconds: float = Field(default=5, gt=0, le=30)
    # Day 4 has no external AI implementation. Unknown/paid provider names fail.
    conversation_mode: Literal["disabled", "mock"] = "disabled"
    story_generation_mode: Literal["disabled", "mock"] = "disabled"

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ):
        # Normalize aliases within each source before Pydantic merges sources.
        # Otherwise a lower-priority file's SUPABASE_* can beat an environment
        # variable using the VITE_* alias merely because AliasChoices lists it first.
        def normalize(source):
            def read():
                values = source()
                for field, backend, frontend in (
                    ("supabase_url", "SUPABASE_URL", "VITE_SUPABASE_URL"),
                    ("supabase_publishable_key", "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"),
                ):
                    for name in (backend, frontend, field):
                        if name in values:
                            selected = values[name]
                            for alias in (backend, frontend, field):
                                values.pop(alias, None)
                            values[backend] = selected
                            break
                return values
            return read

        return tuple(normalize(source) for source in (
            init_settings, env_settings, dotenv_settings, file_secret_settings
        ))

    @field_validator("supabase_url")
    @classmethod
    def validate_supabase_url(cls, value: AnyHttpUrl | None) -> AnyHttpUrl | None:
        if value is None:
            return None
        parsed = urlsplit(str(value))
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Supabase URL must be an origin without credentials")
        if parsed.path not in ("", "/"):
            raise ValueError("Supabase URL must not include a path")
        if parsed.scheme != "https" and parsed.hostname not in (
            "localhost", "127.0.0.1", "::1"
        ):
            raise ValueError("Remote Supabase connections require HTTPS")
        return value

    @field_validator("cors_origins")
    @classmethod
    def validate_origins(cls, origins: list[str]) -> list[str]:
        for origin in origins:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in ("http", "https")
                or not parsed.hostname
                or "*" in origin
                or parsed.path
                or parsed.query
                or parsed.fragment
                or parsed.username
                or parsed.password
            ):
                raise ValueError("CORS origins must be explicit HTTP(S) origins")
        return origins

    @property
    def supabase_configured(self) -> bool:
        return bool(
            self.supabase_url
            and self.supabase_publishable_key
            and self.supabase_publishable_key.get_secret_value().strip()
        )
