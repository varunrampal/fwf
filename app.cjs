import("./server/index.js").catch((error) => {
  console.error("Failed to load server entry:", error);
  process.exit(1);
});
