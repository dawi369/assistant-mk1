/// <reference types="expo/types" />

declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_WORKBENCH_ORIGIN?: string;
    EXPO_PUBLIC_WORKOS_CLIENT_ID?: string;
    EXPO_PUBLIC_WORKOS_ISSUER?: string;
  }
}
