import {
  AudioLines,
  BookOpenCheck,
  Bot,
  Brain,
  Cable,
  Images,
  type LucideIcon,
  PanelsTopLeft,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

export interface Feature {
  id: string;
  /** A short name for lists of features. */
  nav: string;
  icon: LucideIcon;
  title: string;
  summary: string;
  points: readonly string[];
}

/** What Tessel does, shared by the home and features pages. */
export const FEATURES: readonly Feature[] = [
  {
    id: "documents",
    nav: "Documents",
    icon: BookOpenCheck,
    title: "Answers from your documents",
    summary:
      "Upload handbooks, specs, contracts, and notes. Tessel finds the right passages and answers with citations you can open and check.",
    points: [
      "Every answer cites its sources, and each citation opens the passage",
      "Reads PDFs, Word, Excel, PowerPoint, and scanned pages",
      "Transcribes audio and video, and cites the moment something was said",
      "A knowledge graph answers who works on what, across all your files",
    ],
  },
  {
    id: "agents",
    nav: "Agents",
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
    id: "voice",
    nav: "Voice",
    icon: AudioLines,
    title: "Talk it through",
    summary:
      "Have a spoken conversation with Tessel, hands free. It answers out loud in under a second, and you can cut in at any point.",
    points: [
      "Everything said lands in the chat as text",
      "Choose a voice, or record your own on a paid plan",
      "Dictate a message, or have any reply read aloud",
    ],
  },
  {
    id: "create",
    nav: "Pages and apps",
    icon: PanelsTopLeft,
    title: "Pages, apps, and diagrams beside the chat",
    summary:
      "Ask for a web page, a working app, a diagram, or a document, and it opens next to the conversation, running live.",
    points: [
      "Ask for a change and step back through every version",
      "Multi-page apps with a live preview, downloadable as a zip",
      "Runs in a sandbox that can't reach your workspace",
    ],
  },
  {
    id: "media",
    nav: "Images and video",
    icon: Images,
    title: "Images and video",
    summary:
      "Describe an image and Tessel makes it, then edits it as you ask. Paid plans can generate short video clips with sound.",
    points: [
      "Edit any image you made or attached, in plain words",
      "Video runs in the background and shows its progress",
      "Everything you make is kept in your gallery",
    ],
  },
  {
    id: "modes",
    nav: "Ways of working",
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
    nav: "Connected apps",
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
    nav: "Skills",
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
    nav: "Memory",
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
    nav: "Teams",
    icon: Users,
    title: "Built for teams",
    summary:
      "Shared workspaces with owners, admins, and members. Invite people by email and share documents, skills, and connected apps.",
    points: [
      "Roles, invitations, and member controls",
      "Team memory for the projects and conventions everyone shares",
      "Admin policies for tools and apps, and an audit log of who did what",
      "Usage limits per person, with a clear meter",
    ],
  },
  {
    id: "security",
    nav: "Privacy",
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
