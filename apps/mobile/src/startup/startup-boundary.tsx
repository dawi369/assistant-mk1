import { reloadAppAsync } from "expo";
import { Component, type ErrorInfo, type PropsWithChildren } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { clearSavedMobileSession } from "../auth/auth-provider";
import { captureMobileStartupFailure } from "../observability";
import { colors } from "../theme";

type State = { failed: boolean; resetting: boolean; resetFailed: boolean };

export class MobileStartupBoundary extends Component<PropsWithChildren, State> {
  state: State = { failed: false, resetting: false, resetFailed: false };

  static getDerivedStateFromError(): State {
    return { failed: true, resetting: false, resetFailed: false };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    captureMobileStartupFailure(error, "root-render");
  }

  private restart = async () => {
    try {
      await reloadAppAsync("mobile-startup-recovery");
    } catch (error) {
      captureMobileStartupFailure(error, "reload");
      this.setState({ resetFailed: true });
    }
  };

  private reset = async () => {
    this.setState({ resetting: true, resetFailed: false });
    try {
      await clearSavedMobileSession();
      await reloadAppAsync("mobile-startup-authority-reset");
    } catch (error) {
      captureMobileStartupFailure(error, "authority-reset");
      this.setState({ resetting: false, resetFailed: true });
    }
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.screen} accessibilityRole="alert">
        <Text style={styles.eyebrow}>ASSISTANT · MK1</Text>
        <Text style={styles.title}>The app could not finish starting.</Text>
        <Text style={styles.body}>
          Restart first. If it happens again, clear the saved sign-in.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={this.state.resetting}
          onPress={() => void this.restart()}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryLabel}>Restart</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={this.state.resetting}
          onPress={() => void this.reset()}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          {this.state.resetting ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={styles.secondaryLabel}>Clear saved sign-in</Text>
          )}
        </Pressable>
        {this.state.resetFailed ? (
          <Text style={styles.error}>Local recovery failed. Restart the device and try again.</Text>
        ) : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: colors.canvas,
    gap: 14,
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 2,
  },
  title: { color: colors.ink, fontSize: 28, fontWeight: "600", lineHeight: 34 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 24, marginBottom: 8 },
  primary: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  primaryLabel: { color: colors.surface, fontSize: 16, fontWeight: "600" },
  secondary: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  secondaryLabel: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  pressed: { opacity: 0.72 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
