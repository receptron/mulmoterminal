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
  { path: "/", name: "chat", component: Stub },
  { path: "/terminals", name: "terminals", component: Stub },
  { path: "/collections", name: "collections", component: Stub },
  { path: "/collections/:slug", name: "collectionDetail", component: Stub },
  { path: "/feeds", name: "feeds", component: Stub },
  { path: "/feeds/:slug", name: "feedDetail", component: Stub },
  { path: "/accounting", name: "accounting", component: Stub },
  // Read-only wiki browser (Phase 3 of plans/feat-wiki.md). The open PAGE is the URL;
  // graph + lint are their own sub-routes, mirroring MulmoClaude's /wiki paths.
  { path: "/wiki", name: "wiki", component: Stub },
  { path: "/wiki/pages/:slug", name: "wikiPage", component: Stub },
  { path: "/wiki/graph", name: "wikiGraph", component: Stub },
  { path: "/wiki/lint", name: "wikiLint", component: Stub },
  // Unknown URLs land on chat.
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({ history: createWebHistory(), routes });
