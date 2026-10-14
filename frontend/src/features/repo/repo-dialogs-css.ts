// The stylesheet of the repo dialogs (« Follow a repo », « SSH servers »), linked once.
//
// Its own file rather than repo-page.css: these dialogs open from the catalogue screens and
// Settings too, where the repo page's stylesheet was never loaded, and they are mounted at the
// app frame, outside #view-repo, where that file's rules do not reach.
export function ensureRepoDialogCss(): void {
    if (document.getElementById('repo-dialogs-css')) return;
    const link = document.createElement('link');
    link.id = 'repo-dialogs-css';
    link.rel = 'stylesheet';
    link.href = 'css/repo-dialogs.css';
    document.head.appendChild(link);
}
