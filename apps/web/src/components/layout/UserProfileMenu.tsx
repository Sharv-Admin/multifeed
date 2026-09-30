"use client";

import { Logout, Moon, Settings, Sun } from "@honeyicons/react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@multifeed/ui/components/avatar";
import { Button } from "@multifeed/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multifeed/ui/components/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@multifeed/ui/components/tabs";
import { hexclaveClientApp } from "@/hexclave/client";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export type ProfileUser = {
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
};

const getInitials = (value: string | null) =>
  value
    ?.split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

export function UserProfileMenu({ user }: { user: ProfileUser }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const initials =
    getInitials(user.displayName) || getInitials(user.primaryEmail);
  const isDark = resolvedTheme === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open user profile"
        render={<Button size="icon-lg" variant="ghost" />}
      >
        <Avatar className="size-8">
          {user.profileImageUrl && (
            <AvatarImage
              alt={user.displayName ?? ""}
              src={user.profileImageUrl}
            />
          )}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Avatar className="size-9">
            {user.profileImageUrl && (
              <AvatarImage
                alt={user.displayName ?? ""}
                src={user.profileImageUrl}
              />
            )}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            {user.displayName && (
              <div className="truncate text-sm font-semibold">
                {user.displayName}
              </div>
            )}
            {user.primaryEmail && (
              <div className="truncate text-xs text-muted-foreground">
                {user.primaryEmail}
              </div>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />
        <WorkspaceSwitcher />
        <DropdownMenuSeparator />
        <div className="flex items-center gap-2 px-2 py-1">
          <span className="flex items-center gap-2 text-sm">
            <Sun size={16} />
            Theme
          </span>
          <Tabs
            className="ml-auto"
            onValueChange={(value) => setTheme(value as "light" | "dark")}
            value={isDark ? "dark" : "light"}
          >
            <TabsList aria-label="Theme" className="justify-between" size="sm">
              <TabsTrigger
                aria-label="Light mode"
                className="flex-none"
                size="sm"
                title="Light mode"
                value="light"
              >
                <Sun className="size-3" />
              </TabsTrigger>
              <TabsTrigger
                aria-label="Dark mode"
                className="flex-none"
                size="sm"
                title="Dark mode"
                value="dark"
              >
                <Moon className="size-3" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push("/settings")}>
            <Settings size={16} />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => void hexclaveClientApp.signOut()}
          >
            <Logout size={16} />
            Logout
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
