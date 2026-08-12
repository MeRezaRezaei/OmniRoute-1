/**
 * TencentAIStudioWebExecutor — Tencent AI Studio (aistudio.tencent.ai) Web Cookie Provider
 *
 * Routes chat requests through Tencent AI Studio web session via cookie authentication.
 */

import {
  BaseExecutor,
  mergeAbortSignals,
  mergeUpstreamExtraHeaders,
  type ExecuteInput,
} from "./base.ts";
import { FETCH_TIMEOUT_MS } from "../config/constants.ts";
import { buildErrorBody, sanitizeErrorMessage } from "../utils/error.ts";
import { stripCookieInputPrefix } from "@/lib/providers/webCookieAuth";

const AISTUDIO_BASE = "https://aistudio.tencent.ai";

const MODEL_MAP: Record<string, string> = {
  "hy3-g": "HunyuanDefault",
  "hunyuan-default": "HunyuanDefault",
  "hunyuan-3d": "Hunyuan3D",
};

export class TencentAIStudioWebExecutor extends BaseExecutor {
  async execute(input: ExecuteInput): Promise<Response> {
    const { req, body, connection } = input;
    const model = body.model || "hy3-g";

    let cookie = connection.apiKey || "";
    if (!cookie) {
      return new Response(
        JSON.stringify(
          buildErrorBody(
            "Tencent AI Studio Cookie is required. Log in to aistudio.tencent.ai and paste your Cookie header.",
            "invalid_request_error",
            "missing_cookie",
            401
          )
        ),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    cookie = stripCookieInputPrefix(cookie);

    const targetModel = MODEL_MAP[model] || "HunyuanDefault";
    const messages = body.messages || [];

    // Construct request to Tencent AI Studio chat endpoint
    const chatUrl = `${AISTUDIO_BASE}/api/chat/${targetModel}`;

    const headers: Record<string, string> = mergeUpstreamExtraHeaders(
      {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: AISTUDIO_BASE,
        Referer: `${AISTUDIO_BASE}/`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      connection.extraHeaders
    );

    const abortSignal = mergeAbortSignals(req.signal, FETCH_TIMEOUT_MS, connection.provider);

    try {
      const response = await fetch(chatUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: messages.map((m: any) => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
        }),
        signal: abortSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(
          JSON.stringify(
            buildErrorBody(
              sanitizeErrorMessage(`Tencent AI Studio error (${response.status}): ${errorText}`),
              "upstream_error",
              "provider_error",
              response.status
            )
          ),
          {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return response;
    } catch (err: any) {
      return new Response(
        JSON.stringify(
          buildErrorBody(
            sanitizeErrorMessage(err?.message || "Tencent AI Studio request failed"),
            "internal_error",
            "request_failed",
            500
          )
        ),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }
}

export default new TencentAIStudioWebExecutor();
