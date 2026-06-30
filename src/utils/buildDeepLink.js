function normalizeParams(params = {}) {
  if (!params || typeof params !== "object") return {};
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined),
  );
}

export function buildDeepLink({
  path,
  source = "unknown",
  target = "route",
  params = {},
} = {}) {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) {
    throw new Error("buildDeepLink requires a path");
  }

  const normalizedParams = normalizeParams(params);

  return {
    path: normalizedPath,
    state: {
      ...normalizedParams,
      deepLink: {
        version: 1,
        source: String(source || "unknown"),
        target: String(target || "route"),
        params: normalizedParams,
        createdAt: new Date().toISOString(),
      },
    },
  };
}

export function extractDeepLinkParams(state = null) {
  if (!state || typeof state !== "object") return {};

  const deepLinkParams = state.deepLink && typeof state.deepLink === "object"
    ? normalizeParams(state.deepLink.params)
    : {};

  const directParams = normalizeParams(
    Object.fromEntries(
      Object.entries(state).filter(([key]) => key !== "deepLink"),
    ),
  );

  return {
    ...deepLinkParams,
    ...directParams,
  };
}
