// App-wide navigation router. MulmoTerminal renders its 3-pane shell and overlays
// by `route.name` (NOT via <router-view>), so each route only needs to carry a
// name + params — a no-op Stub component satisfies the matcher. This mirrors
// MulmoClaude's Stub + switch-on-route.name pattern, letting the existing shell and
// full-screen overlays (collections / accounting) stay exactly where they are.
//
// The singleton is exported so module-level stores (useCollectionBrowse,
// useAccountingView) can push routes / read currentRoute without component context.
// `routes` is exported for unit tests that want a throwaway memory-history router.
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { defineComponent } from "vue";

const Stub = defineComponent({ name: "RouteStub", render: () => null });

export const routes: RouteRecordRaw[] = [
  // `/` is the DEFAULT-VIEW ENTRY, not a view of its own: which screen the app opens on
  // is this one line (#883). That only holds while navigation goes through route NAMES —
  // a `push("/")` written to mean "the single view" pins the default in place and breaks
  // the moment it moves, which is exactly what this change had to undo in six call sites.
  { path: "/", redirect: { name: "terminals" } },
  { path: "/terminals", name: "terminals", component: Stub },
  { path: "/collections", name: "collections", component: Stub },
  { path: "/collections/:slug", name: "collectionDetail", component: Stub },
  { path: "/feeds", name: "feeds", component: Stub },
  { path: "/feeds/:slug", name: "feedDetail", component: Stub },
  { path: "/accounting", name: "accounting", component: Stub },
  // Named for what it shows — pull requests AND issues — rather than for the half it started as.
  // `/prs` is kept as a redirect: it was the path for long enough to be bookmarked, and the cost
  // of honouring it is this line.
  { path: "/github", name: "github", component: Stub },
  { path: "/prs", redirect: { name: "github" } },
  // The conversation rooms a round table writes to (#1456). The open room is the URL so a
  // conversation can be linked to and reloaded.
  { path: "/rooms", name: "rooms", component: Stub },
  { path: "/rooms/:room", name: "roomView", component: Stub },
  // Blueprint builds (#2246): the list and a new-build form, or one build. The open build is the URL
  // so a build waiting on its owner can be linked to and reloaded.
  { path: "/blueprints", name: "blueprints", component: Stub },
  { path: "/blueprints/market", name: "blueprintMarket", component: Stub },
  { path: "/blueprints/:run", name: "blueprintRun", component: Stub },
  // Full-screen file explorer + editor, rooted at a project dir (?cwd=). Opened from a
  // terminal header's Files button.
  { path: "/files", name: "files", component: Stub },
  // Read-only wiki browser (Phase 3 of plans/feat-wiki.md). The open PAGE is the URL;
  // graph + lint are their own sub-routes, mirroring MulmoClaude's /wiki paths.
  { path: "/wiki", name: "wiki", component: Stub },
  { path: "/wiki/pages/:slug", name: "wikiPage", component: Stub },
  { path: "/wiki/graph", name: "wikiGraph", component: Stub },
  { path: "/wiki/lint", name: "wikiLint", component: Stub },
  // Unknown URLs land on the default view — via `/`, so they follow it wherever it points.
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({ history: createWebHistory(), routes });
