<script setup lang="ts">
// The full-screen frame for the experimental GitHub board (#3172), driven by the /github/board route
// the way GithubOverlay is driven by /github.
import { boardSelection, useGithubBoardView } from "../composables/useGithubBoardView";
import { githubGotoIndex } from "../composables/useGithubView";
import { useEscapeToClose } from "../composables/useEscapeToClose";
import GithubBoard from "./GithubBoard.vue";

const { isOpen, close } = useGithubBoardView();

// An open detail panel is the nearer thing to close.
useEscapeToClose(isOpen, () => {
  if (boardSelection.value) boardSelection.value = null;
  else close();
});
</script>

<template>
  <div v-if="isOpen" class="fixed inset-x-0 top-(--screen-top) bottom-0 z-50 flex flex-col bg-deep">
    <GithubBoard class="min-h-0 flex-auto" @close="close" @list="githubGotoIndex" />
  </div>
</template>
