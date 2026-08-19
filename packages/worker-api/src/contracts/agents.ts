import type { AssetKind, AssetVisibility, CompanyStatus } from "@repo/db/enums";

import type { CompanyBrief } from "../brief";

import type { Template } from "./backoffice";

/**
 * Wire shapes for the agents runtime. These moved out of apps/agents when the
 * Worker lost direct database access: apps/api now produces them and the Worker
 * consumes them, so both sides must typecheck against one declaration.
 */

type AgentDisplayStatus = "available" | "awaiting_approval" | "paused" | "working";

type OpenTicketSlim = {
  status: "awaiting_approval" | "in_progress";
  summary: string;
  ticketId: string;
};

type TeamMemberBase = {
  currentWork: ReadonlyArray<OpenTicketSlim>;
  displayName: string;
  hasPromptOverride: boolean;
  id: string;
  lifetimeDone: number;
  status: AgentDisplayStatus;
};

type TeamMemberNonWorker = TeamMemberBase & {
  role: "correspondent" | "planner";
  templateId: null;
  workerKind: null;
};

type TeamMemberWorker = TeamMemberBase & {
  role: "worker";
  templateId: string;
  workerKind: string;
};

type TeamMemberView = TeamMemberNonWorker | TeamMemberWorker;

type TeamMemberDetailExtras = {
  capabilities: string;
  companyName: string;
  createdAt: number;
  promptOverride: string | null;
  promptOverrideUpdatedAt: number | null;
  templateSystemPrompt: string;
};

type TeamMemberDetailView = TeamMemberView & TeamMemberDetailExtras;

type HireableTemplate = {
  description: string;
  displayName: string;
  hiredCount: number;
  id: string;
  workerKind: string;
};

type Company = {
  brief: Partial<CompanyBrief>;
  createdAt: number;
  id: string;
  locale: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  timezone: string;
  updatedAt: number;
};

type CompanyOverview = {
  briefPercent: number;
  id: string;
  name: string;
  status: CompanyStatus;
};

type SkillConfigValue = boolean | number | string;

type SkillOverlay = {
  defaultConfig: Record<string, SkillConfigValue> | null;
  description: string;
  displayName: string;
  enabled: boolean;
  id: string;
  paramHints: Record<string, string> | null;
  updatedAt: number;
};

type AssetSummary = {
  bytes: number;
  createdAt: number;
  id: string;
  kind: AssetKind;
  mime: string;
  name: string;
  visibility: AssetVisibility;
};

type MaterializeResult = {
  correspondentId: string;
  teamId: string;
  workerIds: ReadonlyArray<string>;
};

type InstanceWithTemplate = {
  agentInstance: { id: string; promptOverride: string | null; templateId: string };
  template: Template;
};

export type {
  AgentDisplayStatus,
  AssetSummary,
  Company,
  CompanyOverview,
  HireableTemplate,
  InstanceWithTemplate,
  MaterializeResult,
  OpenTicketSlim,
  SkillOverlay,
  TeamMemberBase,
  TeamMemberDetailExtras,
  TeamMemberDetailView,
  TeamMemberNonWorker,
  TeamMemberView,
  TeamMemberWorker,
};
