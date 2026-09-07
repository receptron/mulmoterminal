// The Settings modal's words, in English. This is the fallback bundle, so a key another locale has
// not translated yet renders these words rather than the key itself.
//
// Only the Settings modal is here. The rest of the app is still hardcoded English and moves surface
// by surface (#1566) — a half-migrated tree with no rule about what is in it is worse than a small
// one with a stated edge.
//
// `groups.*` and `tabs.*` are keyed by the ids in components/settings/settingsTabs.ts, which is why
// that table holds no words. A spec pins that every id there has a message here and in every other
// locale.
export const en = {
  settings: {
    title: "Settings",
    close: "Close",
    closeAria: "Close settings",
    sectionsNav: "Settings sections",
    sectionPicker: "Settings section",

    groups: {
      appearance: "Appearance",
      projects: "Projects",
      launch: "Header & launch",
      input: "Input",
      models: "Models & servers",
      notifications: "Notifications",
      integrations: "Integrations",
      sessions: "Sessions",
      help: "Help",
    },

    tabs: {
      language: "Language",
      theme: "Theme",
      font: "Terminal font",
      fontSize: "Terminal font size",
      scroll: "Terminal scroll speed",
      waitingRows: "Waiting rows",
      gridHeader: "Grid header read-outs",
      toolbarPins: "Toolbar pins",
      dirAppearance: "Directory appearance",
      dirSettings: "Directory settings",
      launchers: "Launch commands",
      headerChrome: "Header buttons and chips",
      terminalKeys: "Terminal keys",
      shortcuts: "Keyboard shortcuts",
      voice: "Voice input",
      models: "Models and backends",
      mcp: "MCP servers",
      sounds: "Notification sounds",
      push: "Web Push notifications",
      quickCommands: "Phone quick commands",
      github: "GitHub and GitLab",
      prRepos: "Pull request repos",
      google: "Google account",
      sessions: "Sessions and background tasks",
      surviving: "Sessions that survived a restart",
      cost: "Cost (estimated)",
      quit: "Quit MulmoTerminal",
      help: "Help & user guide",
    },

    terminalKeys: {
      copyOnSelect: "Copy a selection as soon as it settles",
      copyOnSelectTitle: "Copy on select",
      copyOnSelectHint:
        "put a mouse selection on the clipboard the moment it settles, with no key pressed. It is the one setting that writes the clipboard when you only meant to highlight.",
      questionPane: "Answer a question from a side pane",
      questionPaneTitle: "Question pane",
      questionPaneHint:
        "when a session asks you something, offer its choices as buttons in a pane beside the terminal. Picking one presses the keys in the dialog the terminal is already showing, so you can still answer there instead.",
      enterTitle: "Enter key",
      enterHint:
        'which bytes the Claude Code running in the terminal reads as "submit". Match it to how you have Claude configured; it applies to Claude sessions only, so a shell\'s Enter is untouched.',
      enterField: "Which bytes submit in a Claude session",
      modes: {
        cr: "Enter submits, Option/Alt+Enter makes a newline (default)",
        "esc-cr": "Option/Alt+Enter submits, Enter makes a newline",
      },
    },

    shortcuts: {
      intro:
        "Read-only, and everything is listed whether it is bound or not, under {keymapKey}. Two kinds can be bound: MulmoTerminal actions (enlarge, jump to a waiting agent, copy / paste), and key sequences sent to the terminal (on a Mac, Cmd+← for start of line). Every key you bind stops reaching the program inside the terminal, so set them up with the button below — the agent checks each one against your existing bindings and the traps a browser or a Mac adds before writing it. The {guide} has the reference.",
      guide: "guide",
      actions: {
        zoomToggle: "Enlarge / collapse a terminal",
        zoomNext: "Enlarge the next terminal",
        zoomPrev: "Enlarge the previous terminal",
        nextAttention: "Jump to a terminal that needs you",
        terminalNew: "Open the launch panel",
        terminalNewHere: "Open the launch panel on this terminal's directory",
        terminalNewAdjacent: "Shell in this terminal's directory, straight away",
        terminalClose: "Close this terminal",
        terminalRestart: "Restart the agent in this terminal",
        copy: "Copy the terminal selection",
        paste: "Paste into the terminal",
      },
      list: "Keyboard shortcuts",
      notSet: "Not set",
      sendRow: "Send {key} to the terminal",
      sendNone: "Send keys to the terminal",
      setUp: "Set up shortcuts…",
    },

    surviving: {
      intro:
        "Terminals outlive the server, so these are still running from an earlier run. A row is listed {whatever} — including one you no longer open, and a shell, which no other list here shows. Stopping a row ends that session only: a conversation with a transcript can be resumed afterwards from its own directory.",
      whatever: "whatever directory it belongs to",
      shellOrUnknown: "shell or unknown",
      unknownAgentTitle: "No agent conversation is recorded under this key — a shell, a launcher command, or an agent this server cannot map back",
      lastActive: "last active {when}",
      loading: "Reading the surviving sessions…",
      failed: "Could not read them — tmux may not be running.",
      unknownDir: "unknown directory",
      unknownDirTitle: "this server has never seen where it runs",
      notResumable: "not resumable",
      notResumableTitle: "Nothing on disk to resume this from",
      doomed: "ends at next start",
      doomedTitle: "Nothing is using it and it has been silent for {days} day(s) — the server ends it at its next start",
      open: "● open",
      openTitle: "A terminal is holding it — close it there",
      stopTitle: "Stop this session",
      stopAria: "Stop the session in {dir}",
      stopAriaUnknown: "an unknown directory",
      none: "None — nothing is running from an earlier server.",
      reapStepper: "the idle days before a session is ended",
      reapUnit: " days",
      neverTitle: "Never ended automatically.",
      neverHint: "They stay until you stop one here, or end it from the terminal holding it.",
      reapHint:
        "A session nothing is using — nobody attached, no output for this long — is {ended}. Its conversation is kept. Set this to 0 to never end one automatically.",
      reapEnded: "ended when the server next starts",
    },

    sounds: {
      intro:
        "Which moments beep, and what each one plays. Running many agents at once is what turns notifications into noise — untick the ones you don't need. The speaker button in the toolbar silences all of them at once.",
      beepAria: "Beep when a session is {kind}",
      soundFor: "Sound for {label}",
      playFor: "Play the {label} sound",
      default: "Default",
      defaultTitle: "Default",
      defaultHint:
        "plays your own file below, or the built-in chime when that is empty. The presets are fetched once and kept on this machine, so they keep working offline.",
      fileField: "Custom notification sound file",
      browse: "Browse…",
      useChime: "Use chime",
      useChimeTitle: "Use the built-in chime",
      outro:
        "These are the sounds for every session. The skill also gives one project its own sound, picks which moments push to your phone, and works out which of them is the one waking you up.",
      configure: "Configure notifications…",
      kinds: {
        finished: "Turn finished",
        waiting: "Waiting for you",
        "command-done": "Command finished",
        "command-failed": "Command failed",
        "session-exited": "Session ended",
        "worker-failed": "Background worker failed",
        "pr-ci-failed": "PR CI failed",
      },
      help: {
        finished: "the agent replied and the output is unread",
        waiting: "it stopped to ask — a permission prompt or a question",
        "command-done": "a Run cell's command exited cleanly",
        "command-failed": "a Run cell's command exited with an error, or never started",
        "session-exited": "a session's terminal ended — including when you close the cell yourself",
        "worker-failed": "a background worker ended without finishing — nothing else reports this, since it has no terminal on screen",
        "pr-ci-failed": "a directory's PR went red. Only seen while the roster is on screen, since that is what polls it",
      },
    },

    guide: {
      prompt: "Not sure how to use MulmoTerminal? Read the guide —",
    },

    push: {
      intro:
        "Send a push to your registered devices when a background task finishes. Requires the {remoteHost} connection — its sign-in provides the notification auth, so pushes only send while it's connected.",
      remoteHost: "RemoteHost",
      master: "Send a Web Push to my devices",
      masterLabel: "Notify my devices",
      whichMoments: "Which moments are worth a push:",
      kindAria: "Push when a session is {kind}",
      kinds: {
        finished: "Turn finished",
        waiting: "Waiting for you",
      },
      help: {
        finished: "the agent replied and the output is unread",
        waiting: "it stopped to ask — a permission prompt or a question. Fires once per prompt, so a task that asks a lot pushes a lot",
      },
    },

    github: {
      issueComments: "Comment on the issue a cell is working on",
      issueCommentsTitle: "Say when work starts on an issue",
      issueCommentsHint:
        "one comment, posted as the work starts and edited as the PR opens and merges. It names the working directory (the folder name, never the path), so two terminals do not start the same issue twice. Needs {gh} (or {glab}) logged in.",
      prFooter: "End a created PR with the clone name",
      prFooterHint: "a {line} line at the bottom of the body, so a PR says which of several side-by-side clones produced it.",
      gitlabTitle: "Self-hosted GitLab",
      gitlabHint:
        "a URL does not say which forge a host runs, so declare it here to have its repos read with {glab}. Needs {authCommand}. Takes effect on the next server start.",
      gitlabField: "Add a self-hosted GitLab host",
    },

    sessions: {
      summary: "End replies with a closing summary",
      summaryHint:
        "what was asked, what was achieved, what was not, under a rule. It exists for the grid: coming back to a cell later, that is otherwise only recoverable by scrolling the whole session. Applies to sessions started from now on; a directory's own {dirFile} wins over this.",
      digest: "Keep a digest of decisions",
      digestTitle: "Keep a digest of what this project decided",
      digestHint: "a Markdown file an agent can read before asking something the project already settled. Writes under {dir}.",
      worklog: "Keep a periodic dev-work log",
      worklogHint: "summarizes recent work across your saved working directories into weekly wiki pages. Each run spawns an LLM session, so it costs tokens.",
      worklogInterval: "How often it runs:",
      worklogStepper: "dev-work log interval",
    },

    launchers: {
      intro:
        "Any interactive command a grid cell can run — a dev server, a REPL, a git UI, a model bridge. It runs in the cell's directory as a persistent terminal, exactly as written. Example: {labelExample} → {commandExample}.",
      notAnAgent: "To start Claude, Codex or Antigravity, use the Agent Picker in an empty cell instead — a launcher gives you none of what a session needs.",
      labelField: "Launcher label",
      labelPlaceholder: "Label",
      commandField: "Launcher command",
      commandPlaceholder: "command (e.g. $SHELL)",
    },

    quickCommands: {
      intro:
        "Phrases you send often, offered as chips on the phone's terminal view. Tapping one puts the text in the input box — it isn't sent until you press send. The label is the chip's face, so keep it short. Example: {labelExample} → {textExample}. Leave every kind unchecked to offer a command everywhere, or tick the ones it suits — {gitStatus} belongs to a shell, not to Claude.",
      labelField: "Quick command label",
      labelPlaceholder: "Label",
      textField: "Quick command text",
      textPlaceholder: "text to insert (e.g. PR作って)",
      offerTo: "Offer to:",
      offerToAgent: "Offer to {agent} sessions",
      offerToNone: "(none ticked = every kind)",
    },

    mcp: {
      intro:
        "HTTP MCP servers the {singleView} Claude session loads (in addition to the built-in GUI tools). {idKey} is the server name; {urlKey} is its streamable-HTTP endpoint. In the Docker sandbox, a {localhost} URL is reached over {dockerHost} automatically. Takes effect on the next Claude session.",
      singleView: "single-view",
      idField: "MCP server id",
      idPlaceholder: "id (e.g. weather)",
      urlField: "MCP server URL",
      urlPlaceholder: "https://… or http://localhost:PORT/mcp",
    },

    headerChrome: {
      intro:
        "The action buttons and the read-out chips along a terminal's header. Globally you have {buttons} and {chips}; a project can add or replace its own by id in its {dirFile}, so what a given terminal shows is the two merged.",
      builtInButtons: "built-in buttons",
      noButtons: "no buttons (all removed)",
      someButtons: "{count} button | {count} buttons",
      builtInChips: "built-in chips",
      noChips: "no chips (all removed)",
      someChips: "{count} chip | {count} chips",
      setUp: "Set up header buttons…",
    },

    models: {
      intro:
        "Anthropic-compatible backends a session can run on, from {providersKey} in {configFile}. A directory can pin one with {providerKey} / {modelKey} in its {dirFile}. A key lives in the environment, never in the config.",
      modelCount: "{count} model | {count} models",
      keyIn: "key in {env}",
      notReady: "not ready",
      notInPicker: "not in the picker",
      ready: "ready",
      noProviders: "None configured — sessions run on the built-in default.",
      customTitle: "Your own way of starting Claude Code",
      customIntro:
        "— offered in the Agent Picker beside Claude / Codex / Antigravity / Shell. Not a launcher: Claude Code's own arguments are appended to the command, so the cell resumes, reports cost and reaches the GUI tools like any other Claude session.",
      noCustomAgents: "None configured.",
      addBackend: "Add a backend…",
    },

    common: {
      add: "Add",
      remove: "Remove {name}",
    },

    dirAppearance: {
      intro:
        "Launch the {skill} skill to style and order your directories — name badge, icon, colors, terminal palette, grid position. It starts from the directories you actually open, reads the settings you already have, and follows the same pattern for the ones that have none.",
      configure: "Configure appearance…",
      favicon: "Use a project's own favicon",
      faviconHint:
        "a directory that sets no {iconKey} shows the one its repository already ships ({svg}, {png}, a web manifest). A project that wants none sets {iconFalse} in its own {dirFile}, which this does not override.",
    },

    dirSettings: {
      intro:
        "What each directory's {dirFile} is actually doing. Expand one to see the values in force, and any key the app dropped or doesn't recognise — a setting that never took effect looks the same as one you never made until you can see this.",
      outro: "This lists what is wrong; the skill reads the same thing and says why, then fixes it or points you at whichever skill owns that key.",
      explain: "Explain my settings…",
    },

    google: {
      intro:
        "Link a Google account so the {tool} tool and your phone can read and create {calendar} events. Sign-in opens in a new tab and finishes on {thisMachine}, so use a browser here — over a remote connection, run {cli} instead. The link is shared with MulmoClaude.",
      calendar: "Calendar",
      thisMachine: "this machine",
      checking: "Checking…",
      pending: "Waiting for consent in your browser…",
      linked: "Linked",
      notLinked: "Not linked",
      signIn: "Sign in with Google",
      unlink: "Unlink",
      confirmUnlink: "Unlink this Google account? MulmoTerminal will lose Calendar access until you sign in again.",
      secretMissing:
        "No OAuth client secret found in ~/.secrets. Add a Desktop client's client_secret_*.json there to enable sign-in, or use the GCP-settings-free broker link if available.",
      secretAmbiguous: "Multiple client_secret_*.json files in ~/.secrets — keep exactly one.",
    },

    prRepos: {
      intro: "Repos whose open PRs the cross-repo {view} view lists. Uses your {gh} login. Format: {format}.",
      view: "Pull requests",
      field: "Add a repository (owner/repo)",
    },

    skillLaunch: {
      hint: "An agent does this for you — it asks a few questions and edits the config file itself.",
    },

    skillConfirm: {
      title: "Let an agent set this up?",
      what: "One new terminal opens in the grid, and {agent} starts there — it asks you a few questions and edits your config file itself.",
      howToStop: "To stop, close that terminal with its close button — the session ends there. Settings reopens from the toolbar whenever you want it.",
      launchWith: "Launch with",
      launchWithAria: "Agent to start this skill with — the same choice collection chats use",
      cancel: "Cancel",
      start: "Start",
    },

    version: {
      label: "Version",
      commit: "commit {sha}",
    },

    voice: {
      intro:
        "The language you dictate in. Speaking a language the mic is not expecting comes back {translated} into the expected one — so pick the one you actually speak rather than leaving it on your browser's.",
      translated: "translated",
      picker: "Language for voice input",
      browserLanguage: "My browser's language",
      detect: "Detect from what I say",
      always: "Always this language",
    },

    stepper: {
      decrease: "Decrease {label}",
      increase: "Increase {label}",
    },

    theme: {
      missing: "The selected theme {id} is not defined. Add it to {themesKey} in {configFile}, or pick one below. Your choice is kept until then.",
      intro:
        "Picks from the schemes that exist. Your own go in {themesKey} in {configFile} and appear here next to the built-in four — the skill writes one from a palette, a photo or a brand's colours, and checks it for contrast.",
      group: "Theme",
      create: "Create a theme…",
    },

    font: {
      intro:
        "The CSS font-family stack every terminal renders in. Reach for it when CJK text looks wrong — a stack whose first face has no Japanese glyphs falls back per character, and the line stops lining up. Leave it empty for the built-in stack. A directory can pin its own with {key} in its {dirFile}.",
      field: "Terminal font family stack",
      apply: "Apply",
      invalid:
        "Not a font stack. Separate names with commas — {example}. CSS syntax characters and unbalanced quotes are refused, because one bad entry invalidates the whole declaration.",
      hint: "Open terminals re-fit as soon as this lands — a different face has a different advance width, so the grid would drift from the canvas otherwise. {mono} is appended when you name no generic family, so a stack that matches nothing still falls back to a fixed-width face.",
    },

    fontSize: {
      stepper: "terminal font size",
      hint: "Applies to every terminal on this browser. A directory can pin its own with {key} in its {dirFile}.",
    },

    scroll: {
      stepper: "terminal scroll speed",
      hint: "How far one wheel notch or trackpad swipe moves the terminal — 1× is the default. Lower it if a two-finger scroll on a Mac trackpad flies past what you were reading. Per browser, and it covers both a shell's scrollback and a full-screen app like Claude Code.",
      returnLabel: "Return to the latest output when you send",
      returnHint:
        "pressing Enter (or a send button) takes a scrolled-up terminal back to the bottom, the way an ordinary terminal does. A shell already behaves this way; a full-screen agent like Claude Code keeps its own scroll position and does not, so this unwinds exactly the scrolling you did. Turn it off to stay where you are reading while a turn runs.",
    },

    toolbarPins: {
      intro:
        "Collections and feeds you pinned can also sit in the toolbar itself, beside Grid and Collections — one press instead of opening Collections first and finding them in the row at its top. Choose up to {max}; the toolbar is unchanged while none is chosen.",
      empty: "Nothing is pinned yet. Open Collections and pin a collection or a feed there first — this list offers what you pinned.",
      unconfirmed:
        "The pinned list could not be re-read ({error}), so this cannot be edited right now — what is shown is what this page loaded earlier, and saving from it could drop a pin you still want. Close and reopen Settings to try again.",
      unavailable:
        "The pinned list is unavailable ({error}), so there is nothing to offer here. The toolbar keeps whatever it was already showing; reopen this once the list is back.",
      full: "{max} is the limit. Clear one to make room — past a handful they crowd out what the toolbar already carries.",
    },

    gridHeader: {
      intro: "What the bar above the grid tells you at a glance, beside the Claude and Codex usage windows it already carries.",
      loadAverage: "Show this machine's load average",
      loadAverageTitle: "Load average",
      loadAverageHint:
        "the load on the machine running your sessions, as a percentage of its cores — 100% means every core has work queued, and starting another agent slows the ones already running. Amber at 100%, red at 200%. A host that keeps no load average (Windows) shows nothing either way.",
    },

    waitingRows: {
      intro:
        "In the list beside an enlarged cell, a row whose agent is {waiting} — a permission prompt, a question — carries an amber ring and blinks. A row that has simply {finished} is green and holds still. Turning this off keeps both colours and stops the movement; rows never blink when your system asks for reduced motion.",
      waiting: "waiting on you",
      finished: "finished",
      blink: "Blink a row that is waiting on me",
      linesTitle: "Lines per row",
      linesHint: "how much of each row is shown before it clamps. Raising these trades how many sessions fit on screen for reading a long one in place.",
      fields: {
        summary: "Summary",
        prompt: "Your prompt",
        response: "Last reply",
      },
      steppers: {
        summary: "summary line count",
        prompt: "your prompt line count",
        response: "last reply line count",
      },
    },

    cost: {
      intro:
        "Estimated spend for this project from {pricing} (input, output, and cache tokens) — actual billing may differ, and flat-plan (Max) usage isn't reflected. Today / Month roll up this project's sessions.",
      pricing: "public per-model pricing",
      group: "Estimated cost",
      groupTitle: "Estimated from public per-model pricing; actual billing may differ.",
      session: "Session",
      today: "Today",
      month: "Month",
      failed: "Couldn't load cost estimate.",
      unpriced: "Some turns used a model with no known price and are excluded from these estimates.",
    },

    quit: {
      description:
        "Stop the MulmoTerminal server running on this machine. Closing this tab does not stop it — the server keeps running, and this is how to stop it without going back to the terminal you started it in.",
      // Message-function form, which skips vue-i18n's message compiler: the literal `@` in
      // `mulmoterminal@latest` would otherwise be read as a linked-message reference, the compiler
      // throws, and the whole section renders as nothing.
      restartHint: () => "To start it again, run `npx mulmoterminal@latest` in a terminal.",
      button: "Quit MulmoTerminal",
      confirmBody: "The server stops and this page stops working. Every terminal on the grid disappears from the screen.",
      sessionsNote:
        'Same as pressing Ctrl+C: with tmux installed the agent sessions keep running and come back under "Sessions that survived a restart" next time; without it they end with the server.',
      confirmButton: "Quit",
      cancel: "Cancel",
      stopping: "Stopping…",
      failed: "Couldn't stop the server.",
      stoppedTitle: "MulmoTerminal has stopped",
      stoppedBody: "You can close this tab.",
    },

    language: {
      intro:
        "The language this app's own buttons and labels are written in. Kept per browser, like the theme — a phone and a desktop can each have their own. It does not touch what your agent writes, or what the terminal shows.",
      picker: "Language for this app",
      auto: "My browser's language",
      autoResolved: "Your browser asks for {locale}, so this reads as {label}.",
      partial: "Only Settings is translated so far. The rest of the app is still in English.",
    },
  },
} as const;
