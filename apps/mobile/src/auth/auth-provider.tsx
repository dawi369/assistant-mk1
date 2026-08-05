import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import { mobileAuthConfigured, mobileConfig } from "../config";

WebBrowser.maybeCompleteAuthSession();

type StoredSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

type AuthState = "loading" | "signed-out" | "signed-in";

type AuthContextValue = {
  state: AuthState;
  configured: boolean;
  getAccessToken(input?: { minValidityMs?: number }): Promise<string | null>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
};

const storageKey = "assistant-mk1.workos-session";
const redirectUri = AuthSession.makeRedirectUri({ scheme: "assistantmk1", path: "auth/callback" });
const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `${mobileConfig.workosIssuer}/user_management/authorize`,
  tokenEndpoint: `${mobileConfig.workosIssuer}/user_management/authenticate`,
};

const AuthContext = createContext<AuthContextValue | null>(null);

const saveSession = async (session: StoredSession | null) => {
  if (!session) return SecureStore.deleteItemAsync(storageKey);
  await SecureStore.setItemAsync(storageKey, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
};

const readSession = async () => {
  const encoded = await SecureStore.getItemAsync(storageKey);
  if (!encoded) return null;
  try {
    const session = JSON.parse(encoded) as StoredSession;
    return session.accessToken && Number.isFinite(session.expiresAt) ? session : null;
  } catch {
    await saveSession(null);
    return null;
  }
};

const fromTokenResponse = (
  response: AuthSession.TokenResponse,
  previousRefreshToken?: string,
): StoredSession => ({
  accessToken: response.accessToken,
  refreshToken: response.refreshToken ?? previousRefreshToken,
  expiresAt:
    (response.issuedAt ?? Math.floor(Date.now() / 1000)) * 1000 +
    (response.expiresIn ?? 3_600) * 1000,
});

export function MobileAuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [state, setState] = useState<AuthState>("loading");
  const refreshPromise = useRef<Promise<StoredSession | null> | null>(null);

  useEffect(() => {
    void readSession().then((stored) => {
      setSession(stored);
      setState(stored ? "signed-in" : "signed-out");
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.refreshToken || !mobileAuthConfigured) return null;
    if (!refreshPromise.current) {
      refreshPromise.current = AuthSession.refreshAsync(
        {
          clientId: mobileConfig.workosClientId,
          refreshToken: session.refreshToken,
        },
        discovery,
      )
        .then(async (response) => {
          const next = fromTokenResponse(response, session.refreshToken);
          await saveSession(next);
          setSession(next);
          setState("signed-in");
          return next;
        })
        .catch(async () => {
          await saveSession(null);
          setSession(null);
          setState("signed-out");
          return null;
        })
        .finally(() => {
          refreshPromise.current = null;
        });
    }
    return refreshPromise.current;
  }, [session]);

  const getAccessToken = useCallback(
    async (input?: { minValidityMs?: number }) => {
      if (!session) return null;
      if (session.expiresAt - Date.now() > (input?.minValidityMs ?? 60_000)) {
        return session.accessToken;
      }
      return (await refresh())?.accessToken ?? null;
    },
    [refresh, session],
  );

  const signIn = useCallback(async () => {
    if (!mobileAuthConfigured) throw new Error("Mobile WorkOS client is not configured");
    const request = new AuthSession.AuthRequest({
      clientId: mobileConfig.workosClientId,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ["openid", "profile", "email", "offline_access"],
      usePKCE: true,
    });
    await request.makeAuthUrlAsync(discovery);
    const result = await request.promptAsync(discovery, { showInRecents: true });
    if (result.type !== "success" || !result.params.code || !request.codeVerifier) return;
    const response = await AuthSession.exchangeCodeAsync(
      {
        clientId: mobileConfig.workosClientId,
        code: result.params.code,
        redirectUri,
        extraParams: { code_verifier: request.codeVerifier },
      },
      discovery,
    );
    const next = fromTokenResponse(response);
    await saveSession(next);
    setSession(next);
    setState("signed-in");
  }, []);

  const signOut = useCallback(async () => {
    refreshPromise.current = null;
    await saveSession(null);
    setSession(null);
    setState("signed-out");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, configured: mobileAuthConfigured, getAccessToken, signIn, signOut }),
    [getAccessToken, signIn, signOut, state],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useMobileAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useMobileAuth must be used inside MobileAuthProvider");
  return context;
};
