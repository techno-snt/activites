/* Techno & SNT Lab : met en pause l'animation du paquet si l'utilisateur
   préfère moins de mouvement. */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.querySelectorAll("svg.net").forEach(function (s) {
        if (s.pauseAnimations) s.pauseAnimations();
      });
    }
  });
})();
