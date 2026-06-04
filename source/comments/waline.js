import { commentCount, init } from 'https://unpkg.com/@waline/client@v3/dist/waline.js';
import { pageviewCount } from 'https://unpkg.com/@waline/client@v3/dist/pageview.js';

(() => {
  const serverURL = 'https://cyblwalcom.zeabur.app/';
  let firstVisit = true;
  let waline;

  const loadComments = async () => {
    waline?.destroy();
    waline = undefined;

    const container = document.getElementById('w-comments');
    if (container) {
      waline = init({
        el: container,
        path: container.getAttribute('data-path'),
        dark: 'html[data-theme="dark"]',
        serverURL,
        pageview: true,
        comment: true,
      });
    } else {
      pageviewCount({
        serverURL,
        update: false,
      });
      commentCount({
        serverURL,
      });
    }

    if (firstVisit) {
      firstVisit = false;
      pageviewCount({
        serverURL,
        path: '/index.html',
      });
    }
  };

  window.loadComments = loadComments;
  loadComments().finally(() => {
    window.loadComments = null;
  });

  window.addEventListener('pjax:success', () => {
    window.loadComments = loadComments;
  });
})();
