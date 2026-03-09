from __future__ import annotations

import base64
import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional


class LamHttpError(Exception):
    def __init__(self, status: int, body: Any):
        super().__init__(f"LAM HTTP {status}")
        self.status = status
        self.body = body


def _strip_trailing_slash(s: str) -> str:
    while s.endswith("/"):
        s = s[:-1]
    return s


def _add_scope(params: Dict[str, Any], scope_user: Optional[str], scope_org: Optional[str], scope_project: Optional[str], namespace: Optional[str]) -> None:
    if scope_user is not None:
        params["scope_user"] = scope_user
    if scope_org is not None:
        params["scope_org"] = scope_org
    if scope_project is not None:
        params["scope_project"] = scope_project
    if namespace is not None:
        params["namespace"] = namespace


@dataclass
class LamClient:
    base_url: str
    token: str
    timeout_s: float = 30.0
    user_agent: str = "lam-python-sdk/0.1"

    def __post_init__(self) -> None:
        self.base_url = _strip_trailing_slash(self.base_url)

    def _request(self, method: str, path: str, query: Optional[Dict[str, Any]] = None, json_body: Any = None) -> Any:
        q = query or {}
        qs = urllib.parse.urlencode({k: str(v) for k, v in q.items() if v is not None}, doseq=True)
        url = f"{self.base_url}{path}"
        if qs:
            url = f"{url}?{qs}"

        headers = {
            "Authorization": f"Bearer {self.token}",
            "User-Agent": self.user_agent,
        }

        data: Optional[bytes] = None
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url=url, method=method, headers=headers, data=data)

        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                raw = resp.read()
                if not raw:
                    return None
                try:
                    return json.loads(raw.decode("utf-8"))
                except Exception:
                    return raw.decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            raw = e.read()
            body: Any
            try:
                body = json.loads(raw.decode("utf-8")) if raw else None
            except Exception:
                body = raw.decode("utf-8", errors="replace") if raw else None
            raise LamHttpError(e.code, body) from None
        except (urllib.error.URLError, socket.timeout) as e:
            raise RuntimeError(f"Failed to reach LAM at {self.base_url}: {e}") from None

    def ingest(
        self,
        content: str,
        content_type: str = "text/plain; charset=utf-8",
        claims: Optional[list[dict[str, Any]]] = None,
        *,
        scope_user: Optional[str] = None,
        scope_org: Optional[str] = None,
        scope_project: Optional[str] = None,
        namespace: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"content_type": content_type, "content": content}
        if claims is not None:
            body["claims"] = claims
        _add_scope(body, scope_user, scope_org, scope_project, namespace)
        return self._request("POST", "/v1/ingest", json_body=body)

    def ingest_bytes(
        self,
        content: bytes,
        content_type: str = "application/octet-stream",
        claims: Optional[list[dict[str, Any]]] = None,
        *,
        scope_user: Optional[str] = None,
        scope_org: Optional[str] = None,
        scope_project: Optional[str] = None,
        namespace: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "content_type": content_type,
            "content_b64": base64.b64encode(content).decode("ascii"),
        }
        if claims is not None:
            body["claims"] = claims
        _add_scope(body, scope_user, scope_org, scope_project, namespace)
        return self._request("POST", "/v1/ingest", json_body=body)

    def recall(
        self,
        q: str,
        limit: int = 30,
        include_tokens: bool = False,
        *,
        scope_user: Optional[str] = None,
        scope_org: Optional[str] = None,
        scope_project: Optional[str] = None,
        namespace: Optional[str] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {"q": q, "limit": limit, "include_tokens": 1 if include_tokens else 0}
        _add_scope(params, scope_user, scope_org, scope_project, namespace)
        return self._request("GET", "/v1/recall", query=params)

    def retrieve(
        self,
        q: str,
        *,
        limit: int = 20,
        hops: Optional[int] = None,
        k_seeds: Optional[int] = None,
        k_expand: Optional[int] = None,
        include_evidence: Optional[bool] = None,
        include_quotes: Optional[bool] = None,
        evidence_strategy: Optional[str] = None,
        include_tokens: Optional[bool] = None,
        max_per_cell: Optional[int] = None,
        as_of: Optional[str] = None,
        scope_user: Optional[str] = None,
        scope_org: Optional[str] = None,
        scope_project: Optional[str] = None,
        namespace: Optional[str] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {"q": q, "limit": limit}
        if hops is not None:
            params["hops"] = hops
        if k_seeds is not None:
            params["k_seeds"] = k_seeds
        if k_expand is not None:
            params["k_expand"] = k_expand
        if include_evidence is not None:
            params["include_evidence"] = 1 if include_evidence else 0
        if include_quotes is not None:
            params["include_quotes"] = 1 if include_quotes else 0
        if evidence_strategy is not None:
            params["evidence_strategy"] = evidence_strategy
        if include_tokens is not None:
            params["include_tokens"] = 1 if include_tokens else 0
        if max_per_cell is not None:
            params["max_per_cell"] = max_per_cell
        if as_of is not None:
            params["as_of"] = as_of
        _add_scope(params, scope_user, scope_org, scope_project, namespace)
        return self._request("GET", "/v1/retrieve", query=params)

    def forget_by_cell_id(
        self,
        cell_id: str,
        *,
        mode: str = "hard",
        reason: str = "",
        scope_user: Optional[str] = None,
        scope_org: Optional[str] = None,
        scope_project: Optional[str] = None,
        namespace: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"cell_id": cell_id, "mode": mode, "reason": reason}
        _add_scope(body, scope_user, scope_org, scope_project, namespace)
        return self._request("POST", "/v1/forget", json_body=body)

    def forget_by_query(
        self,
        q: str,
        *,
        limit_cells: int = 25,
        include_tokens: bool = False,
        mode: str = "hard",
        reason: str = "",
        scope_user: Optional[str] = None,
        scope_org: Optional[str] = None,
        scope_project: Optional[str] = None,
        namespace: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "q": q,
            "limit_cells": limit_cells,
            "include_tokens": 1 if include_tokens else 0,
            "mode": mode,
            "reason": reason,
        }
        _add_scope(body, scope_user, scope_org, scope_project, namespace)
        return self._request("POST", "/v1/forget", json_body=body)
