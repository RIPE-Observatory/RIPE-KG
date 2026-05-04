(function () {
  var suppressSelectionPost = false;

  function graph() {
    return window.webvowl && window.webvowl.gr ? window.webvowl.gr : null;
  }

  function iriOf(element) {
    return element && typeof element.iri === "function" ? element.iri() : "";
  }

  function elementByIri(iri) {
    var currentGraph = graph();
    if (!currentGraph || typeof currentGraph.getUpdateDictionary !== "function") return null;
    var elements = currentGraph.getUpdateDictionary();
    for (var index = 0; index < elements.length; index += 1) {
      if (iriOf(elements[index]) === iri) return elements[index];
    }
    return null;
  }

  function postSelection(element) {
    var iri = iriOf(element);
    if (suppressSelectionPost || iri.indexOf("http") !== 0) return;
    window.parent.postMessage({ source: "ripe-webvowl", type: "selection", iri: iri }, "*");
  }

  function wrapFocuser() {
    var currentGraph = graph();
    if (!currentGraph || !currentGraph.options) return false;
    var focuser = currentGraph.options().focuserModule && currentGraph.options().focuserModule();
    if (!focuser || !focuser.handle || focuser.__ripeBridgeWrapped) return false;

    var originalHandle = focuser.handle;
    focuser.handle = function (element) {
      postSelection(element);
      return originalHandle.apply(this, arguments);
    };
    focuser.__ripeBridgeWrapped = true;
    return true;
  }

  function focusTerm(iri) {
    var currentGraph = graph();
    var element = elementByIri(iri);
    if (!currentGraph || !currentGraph.options || !element) return false;

    suppressSelectionPost = true;
    currentGraph.resetSearchHighlight();
    currentGraph.options().focuserModule().reset();
    currentGraph.options().focuserModule().handle(element, true);
    if (typeof element.foreground === "function") element.foreground();
    if (typeof element.drawHalo === "function") element.drawHalo();
    suppressSelectionPost = false;
    return true;
  }

  window.addEventListener("message", function (event) {
    var message = event.data || {};
    if (message.source !== "ripe-ontology" || message.type !== "focus" || !message.iri) return;

    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      if (focusTerm(message.iri) || attempts > 40) window.clearInterval(timer);
    }, 75);
  });

  window.onload = function () {
    window.webvowl.app().initialize();

    var attempts = 0;
    var timer = window.setInterval(function () {
      var currentGraph = graph();
      attempts += 1;
      wrapFocuser();

      if (currentGraph && currentGraph.options && !window.__ripeOntologyLoaded) {
        var loader = currentGraph.options().ontologyMenu().getLoadingFunction();
        if (loader) {
          window.__ripeOntologyLoaded = true;
          fetch("data/ontology.json")
            .then(function (response) { return response.text(); })
            .then(function (text) { loader(text, "RIPE-O + InspectAI"); })
            .catch(function (error) { console.error("Failed to load RIPE WebVOWL JSON", error); });
        }
      }

      if (attempts > 80) window.clearInterval(timer);
    }, 100);
  };
})();
