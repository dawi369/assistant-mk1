/**
 * Shared UI utility helpers.
 *
 * This module intentionally stays tiny: `cn` is the common Tailwind class
 * composition helper used by shadcn-style components to merge conditional
 * classes without duplicating class conflict logic.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
