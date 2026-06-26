// GitOps Review Webapp — tiny client-side enhancement.
// Note: no console.log here on purpose; the review script rejects it.

(function () {
  "use strict";

  var detail = document.getElementById("status-detail");
  if (detail) {
    var when = new Date().toLocaleString();
    detail.textContent =
      "This build was reviewed and built before deploy. Page loaded at " + when + ".";
  }
})();
