(() => {
  const loadComments = async () => {
    if (typeof Gitalk === "undefined") {
      setTimeout(loadComments, 100);
    } else {
      const container = document.getElementById('gitalk-container');
      if (!container) {
        return;
      }
      const path = container.getAttribute("data-path");
      const gitalk = new Gitalk(Object.assign({
          id: path, // 直接使用路径作为 id
          // id: container.getAttribute("data-path-hash"), // 使用 hash 作为 ID
          path: path,
      }, {
        clientID: 'Ov23liOVSOxyfDUOdxWf',
        clientSecret: '49b8917aa2a4ab5db90a3e00caa1b325eb734be6',
        repo: "cyberl-ty02.github.io",
        owner: "Cyberl-ty02",
        admin: ["Cyberl-ty02"],
        distractionFreeMode: false,
      }));

      gitalk.render('gitalk-container');
    }
  };

  window.loadComments = loadComments;
  window.addEventListener('pjax:success', () => {
    window.loadComments = loadComments;
  });
})();
