module.exports = {
  hooks: {
    readPackage(pkg) {
      // This immutable artifact must share the host's directly pinned common package.
      if (pkg.name === "@uxheavy/excalidraw" && pkg.version === "0.18.1-ce4cf488") {
        pkg.peerDependencies = { ...pkg.peerDependencies, "@excalidraw/common": pkg.version };
        delete pkg.dependencies["@excalidraw/common"];
      }
      return pkg;
    },
  },
};
