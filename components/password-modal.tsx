"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface PasswordModalProps {
  open: boolean;
  title?: string;
  description?: string;
  loading?: boolean;
  error?: string;
  showMergeOption?: boolean;
  mergeEnabled?: boolean;
  onMergeChange?: (v: boolean) => void;
  onClose: () => void;
  onSubmit: (password: string) => void;
}

export function PasswordModal({
  open,
  title = "Enter your password",
  description = "Your journal is encrypted. Enter your account password to continue.",
  loading,
  error,
  showMergeOption,
  mergeEnabled,
  onMergeChange,
  onClose,
  onSubmit,
}: PasswordModalProps) {
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    onSubmit(password);
    setPassword("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm border-zinc-800 bg-zinc-950">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-zinc-400">{description}</p>
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            className="bg-zinc-900 border-zinc-700"
          />
          {showMergeOption && (
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="merge"
                checked={mergeEnabled}
                onCheckedChange={(v) => onMergeChange?.(v === true)}
              />
              <Label htmlFor="merge" className="text-sm text-zinc-300 cursor-pointer">
                Also import latest cloud changes
              </Label>
            </div>
          )}
          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} className="text-zinc-400">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!password || loading}
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              {loading ? "Processing…" : "Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
