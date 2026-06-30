export const FAQ_SECTIONS = [
  {
    id: "getting-started",
    title: "Getting Started",
    items: [
      {
        q: "How do I generate my first post?",
        a: "Open Generate, describe the content you want, then start a generation. Your results appear in the current session and you can review each variation before scheduling or publishing anything.",
      },
      {
        q: "Do I need to connect a platform before using SocialAI?",
        a: "No. You can generate content before connecting any accounts. You only need a connected account when you want to schedule or publish to a specific platform.",
      },
      {
        q: "What is the Brand Kit used for?",
        a: "Your Brand Kit gives the AI your voice, audience, visual direction, and content guardrails. Completing it usually leads to more consistent captions and media outputs.",
      },
      {
        q: "Where can I find content after it is generated?",
        a: "Recent generations appear on your dashboard and in the Generate workspace. Once a post exists as a draft or scheduled item, you can also manage it from Calendar and Library.",
      },
    ],
  },
  {
    id: "content-generation",
    title: "Content Generation",
    items: [
      {
        q: "Why did my generation fail?",
        a: "Generation failures are usually temporary processing issues, unsupported input, or a missing media result. Retry from the same session first. If the problem keeps happening, submit a ticket with the time and prompt used.",
      },
      {
        q: "Can I generate variations from the same idea?",
        a: "Yes. Keep working in the same Generate session to create additional outputs from the same prompt direction. That keeps your related content grouped together.",
      },
      {
        q: "How do I get better AI results?",
        a: "Be specific about the goal, audience, platform, tone, and visual direction. If you have a Brand Kit, keep it updated so the model has stronger context for voice and style.",
      },
      {
        q: "Does content auto-publish as soon as it is generated?",
        a: "No. Generated content goes through your review flow first. You choose whether to keep it as a draft, schedule it for later, or publish it now when the path is available.",
      },
      {
        q: "Where do titles come from in my generation history?",
        a: "Titles are derived from session data or prompt content. If a generation does not have an explicit title yet, the app falls back to a shortened version of your prompt.",
      },
    ],
  },
  {
    id: "scheduling-calendar",
    title: "Scheduling & Calendar",
    items: [
      {
        q: "How do I schedule a post?",
        a: "Choose a generated result or draft, open the scheduling flow, then pick a date and time. Scheduled items are managed from Calendar, where you can review upcoming and historical posts.",
      },
      {
        q: "Can I edit a scheduled post later?",
        a: "Yes. Scheduled items can be rescheduled and adjusted from the calendar workflow. Published history should be treated as final, so older published records may not behave like editable drafts.",
      },
      {
        q: "What can I track in Analytics?",
        a: "Analytics shows personal app-side platform activity today: generated content, drafts, scheduled posts, published posts, connected account health, and platform mix. Native social media metrics such as views, likes, comments, shares, and audience growth are coming soon.",
      },
      {
        q: "What statuses should I expect in Calendar?",
        a: "The active post lifecycle is draft, scheduled, publishing, published, and failed. Those same statuses also feed dashboard counts and admin reporting.",
      },
    ],
  },
  {
    id: "publishing",
    title: "Publishing",
    items: [
      {
        q: "What happens after I schedule a post?",
        a: "The post is stored with a scheduled state and remains visible in Calendar and related user/admin views. A full automated publishing worker is still part of the roadmap, so some scheduling flows are demo-ready rather than fully production-complete.",
      },
      {
        q: "What does a failed post mean?",
        a: "A failed post means the publish lifecycle did not complete successfully. You can inspect it in Calendar or Library, and in some flows retry or move it back into a workable state.",
      },
      {
        q: "Can I publish to multiple accounts?",
        a: "Yes, where the flow supports it. Posts are created per target account, so publishing and scheduling outcomes are tracked against specific connected accounts rather than one shared post row.",
      },
      {
        q: "Why can’t I publish to a platform right now?",
        a: "This build still treats some platform connections and publishing paths as incomplete or mock-mode. Check your connected account status in Settings first, then raise a support ticket if the account looks healthy but publishing still fails.",
      },
    ],
  },
  {
    id: "account-credits",
    title: "Account & Credits",
    items: [
      {
        q: "Where do I manage connected accounts?",
        a: "Open Settings to review connected social accounts, revoke a connection, or confirm whether an account is active, expired, or running in mock mode.",
      },
      {
        q: "Where can I update my Brand Kit?",
        a: "Open Settings and go to Brand Kit. That workspace lets you save brand rules, upload assets, and refine the AI context used during generation.",
      },
      {
        q: "How do credits work in this build?",
        a: "Your profile stores a credits value that is surfaced in the user experience, but credit accounting is still evolving. If credits look incorrect, include a screenshot and the affected workflow in a support ticket.",
      },
      {
        q: "How do I reset my password or regain access?",
        a: "Use the normal sign-in recovery flow first. If you were locked out after an admin or platform issue, submit a support ticket and include the email on the account.",
      },
    ],
  },
];
