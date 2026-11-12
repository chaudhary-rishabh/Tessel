import {
  BookOpenCheck,
  Bot,
  Brain,
  Cable,
  type LucideIcon,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

export interface Feature {
  id: string;
  icon: LucideIcon;
  title: string;
  summary: string;
  points: readonly string[];
}

/** What Tessel does, shared by the home and features pages. */
export const FEATURES: readonly Feature[] = [
  {
    id: "documents",
    icon: BookOpenCheck,
    title: "Answers from your documents",
    summary:
      "Upload handbooks, specs, contracts, and notes. Tessel finds the right passages and answers with citations you can open and check.",
    points: [
      "Hybrid search with reranking finds the passages that matter",
      "Every answer cites its sources, and each citation opens the passage",
      "A knowledge graph answers who works on what, across all your files",
    ],
  },
  {
    id: "agents",
    icon: Bot,
    title: "Agents that ask before they act",
    summary:
      "Hand Tessel real work. It searches, calculates, and drafts with your tools, and waits for your approval before changing anything.",
    points: [
      "Anything that changes your workspace waits for Allow or Decline",
      "A pending approval survives reloads and restarts",
      "See every step as it happens",
    ],
  },
  {
    id: "modes",
    icon: Workflow,
    title: "Pick how it works",
    summary:
      "Answer straight away, plan and work through steps, draft and review, or hand parts of a task to a team of specialists.",
    points: [
      "Four ways of working for quick questions or big tasks",
      "Live progress for every stage",
      "Approvals work the same in every mode",
    ],
  },
  {
    id: "connectors",
    icon: Cable,
    title: "Your apps, connected through MCP",
    summary:
      "Connect GitHub, Notion, Linear, or any remote MCP server, and choose which tools need approval. Tessel is an MCP server too.",
    points: [
      "Sign in to each app with OAuth or a token",
      "Per-tool choices: always allow, ask first, or off",
      "Use your workspace from Claude Desktop or Cursor",
    ],
  },
  {
    id: "skills",
    icon: Sparkles,
    title: "Skills for repeat work",
    summary:
      "Built-in and team-written instructions for meeting notes, release notes, decision memos, and more, used when a request matches.",
    points: [
      "Write a skill once, and the whole team gets it",
      "Tessel picks the right skill for the request",
      "Edit or turn off any skill",
    ],
  },
  {
    id: "memory",
    icon: Brain,
    title: "Memory you control",
    summary:
      "Tessel remembers lasting facts about you and can search your past chats, so you stop repeating yourself.",
    points: [
      "Long chats are summarized so context isn't lost",
      "See, edit, and delete everything it remembers",
      "Switch memory off whenever you like",
    ],
  },
  {
    id: "teams",
    icon: Users,
    title: "Built for teams",
    summary:
      "Shared workspaces with owners, admins, and members. Invite people by email and share documents, skills, and connected apps.",
    points: [
      "Roles, invitations, and member controls",
      "An audit log of who did what",
      "Usage limits per person, with a clear meter",
    ],
  },
  {
    id: "security",
    icon: ShieldCheck,
    title: "Private by design",
    summary:
      "Every workspace is walled off in the database itself, and documents and tool results are treated as data, never as instructions.",
    points: [
      "Row-level security in Postgres for every workspace",
      "Two-step sign-in, device sessions, and access tokens",
      "Moderation and spend caps on every model call",
    ],
  },
];
