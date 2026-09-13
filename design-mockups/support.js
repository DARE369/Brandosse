/* =============================================================================
   support.js — minimal runtime for the .dc.html mockup format.

   WHY THIS FILE EXISTS
   --------------------
   Every .dc.html mockup in this folder opens with `<script src="./support.js">`
   and expects a template runtime that was never checked into this repo. Without
   it a .dc.html file opens in a browser as raw output: every `<sc-if>` branch
   visible at once, stacked on top of each other, with `{{bindings}}` printed
   literally. That is what you see, not a broken mockup.

   This is that runtime, reimplemented from what the mockups actually use — no
   more. It is a review tool, not a framework, and nothing under src/ imports it.

   WHAT IT SUPPORTS
   ----------------
     <helmet>                  contents are moved into <head>
     {{path.to.value}}         in text and in any attribute value
     <sc-if value="{{x}}">     renders children only when x is truthy
     <sc-for list="{{xs}}" as="item">   repeats children, `item` in scope
     onClick="{{handler}}"     binds a click listener (also onInput/onChange)
     defaultValue="{{v}}"      sets an input/textarea's initial value
     <image-slot>              defined separately in image-slot.js
     class Component extends DCLogic { state, renderVals() }

   The component re-renders wholesale on setState. That is fine at mockup scale
   and keeps the runtime honest about what it is; focus and caret position in the
   focused field are preserved across renders so typing still feels normal.

   KNOWN LIMIT, stated rather than hidden: `<sc-if>`/`<sc-for>` cannot be used
   directly inside <table>/<tbody>/<tr>. The HTML parser hoists unknown elements
   out of table content before this script ever sees them, so a table built that
   way silently loses its rows. Build tabular layouts from divs with
   role="table"/"row"/"cell" instead — the mockups here do.
   ============================================================================= */
(function () {
  "use strict";

  var BINDING = /\{\{([^}]*)\}\}/g;
  var ONLY_BINDING = /^\s*\{\{([^}]*)\}\}\s*$/;

  /* ---------------------------------------------------------------------------
     Scope lookup. Expressions in these mockups are dotted paths and the two
     literals `true`/`false` — deliberately not a JS evaluator, because a mockup
     template should not be able to run arbitrary code from an attribute.
     --------------------------------------------------------------------------- */
  function resolve(expr, scope) {
    var path = String(expr).trim();
    if (path === "true") return true;
    if (path === "false") return false;
    if (path === "") return undefined;

    var parts = path.split(".");
    var cur = scope;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function interpolate(str, scope) {
    return str.replace(BINDING, function (_, expr) {
      var v = resolve(expr, scope);
      return v === null || v === undefined || v === false ? "" : String(v);
    });
  }

  // When an attribute is exactly one binding, hand back the real value (a
  // function, a boolean, an array) rather than its string form.
  function singleValue(str, scope) {
    var m = ONLY_BINDING.exec(str);
    return m ? resolve(m[1], scope) : undefined;
  }

  var EVENT_ATTRS = {
    onclick: "click",
    oninput: "input",
    onchange: "change",
    onsubmit: "submit",
    onkeydown: "keydown",
    onfocus: "focus",
    onblur: "blur",
  };

  /* ---------------------------------------------------------------------------
     Template walk
     --------------------------------------------------------------------------- */
  var SVG_NS = "http://www.w3.org/2000/svg";

  function processChildren(node, scope, out, svgMode) {
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) processNode(kids[i], scope, out, svgMode);
  }

  function processNode(node, scope, out, svgMode) {
    // Text
    if (node.nodeType === 3) {
      var text = node.nodeValue;
      out.appendChild(
        document.createTextNode(
          text.indexOf("{{") === -1 ? text : interpolate(text, scope)
        )
      );
      return;
    }
    if (node.nodeType === 8) return; // drop comments
    if (node.nodeType !== 1) return;

    var tag = node.tagName.toLowerCase();

    if (tag === "sc-if") {
      if (singleValue(node.getAttribute("value") || "", scope)) {
        processChildren(node, scope, out, svgMode);
      }
      return;
    }

    if (tag === "sc-for") {
      var list = singleValue(node.getAttribute("list") || "", scope);
      var as = node.getAttribute("as") || "item";
      if (Array.isArray(list)) {
        for (var i = 0; i < list.length; i++) {
          // Prototype chain, so the loop variable shadows without copying the
          // whole outer scope on every iteration.
          var inner = Object.create(scope);
          inner[as] = list[i];
          inner[as + "Index"] = i;
          processChildren(node, inner, out, svgMode);
        }
      }
      return;
    }

    // Icons are inline SVG. createElement() would build an HTML element with an
    // svg-shaped name, which renders nothing at all — the namespace has to be
    // carried explicitly, and stay carried for every descendant.
    var inSvg = svgMode || tag === "svg";
    var el = inSvg
      ? document.createElementNS(SVG_NS, node.tagName)
      : document.createElement(tag);
    var deferredValue = null;

    var attrs = node.attributes;
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name;
      var raw = attrs[a].value;

      // Authoring-time hints for the design tool; meaningless at runtime.
      if (name.indexOf("hint-") === 0) continue;

      var evt = EVENT_ATTRS[name];
      if (evt) {
        var fn = singleValue(raw, scope);
        if (typeof fn === "function") {
          (function (element, type, handler) {
            element.addEventListener(type, handler);
          })(el, evt, fn);
        }
        continue;
      }

      // HTML lowercases attribute names, so defaultValue arrives as defaultvalue.
      if (name === "defaultvalue") {
        var dv = singleValue(raw, scope);
        deferredValue = dv === undefined ? interpolate(raw, scope) : dv;
        continue;
      }

      el.setAttribute(name, raw.indexOf("{{") === -1 ? raw : interpolate(raw, scope));
    }

    processChildren(node, scope, el, inSvg);

    if (deferredValue !== null && deferredValue !== undefined) {
      el.value = String(deferredValue);
    }

    out.appendChild(el);
  }

  /* ---------------------------------------------------------------------------
     Focus/caret preservation across a full re-render.
     --------------------------------------------------------------------------- */
  function captureFocus() {
    var el = document.activeElement;
    if (!el || !el.id) return null;
    var snap = { id: el.id, start: null, end: null };
    try {
      if (typeof el.selectionStart === "number") {
        snap.start = el.selectionStart;
        snap.end = el.selectionEnd;
      }
    } catch (_) { /* selection unsupported on this element type */ }
    return snap;
  }

  function restoreFocus(snap) {
    if (!snap) return;
    var el = document.getElementById(snap.id);
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
      if (snap.start !== null && typeof el.setSelectionRange === "function") {
        el.setSelectionRange(snap.start, snap.end);
      }
    } catch (_) { /* the element no longer accepts focus; not worth failing over */ }
  }

  /* ---------------------------------------------------------------------------
     Base class the mockups extend.
     --------------------------------------------------------------------------- */
  function DCLogic(props) {
    this.props = props || {};
    if (!this.state) this.state = {};
  }

  DCLogic.prototype.setState = function (patch, callback) {
    var next = typeof patch === "function" ? patch(this.state) : patch;
    var merged = {};
    var k;
    for (k in this.state) if (Object.prototype.hasOwnProperty.call(this.state, k)) merged[k] = this.state[k];
    for (k in next) if (Object.prototype.hasOwnProperty.call(next, k)) merged[k] = next[k];
    this.state = merged;
    if (this.__rerender) this.__rerender();
    if (typeof callback === "function") callback();
  };

  window.DCLogic = DCLogic;

  /* ---------------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------------- */
  function readDefaultProps(scriptEl) {
    var raw = scriptEl.getAttribute("data-props");
    if (!raw) return {};
    var spec;
    try {
      spec = JSON.parse(raw);
    } catch (err) {
      console.warn("[dc] data-props is not valid JSON; ignoring.", err);
      return {};
    }
    var props = {};
    Object.keys(spec).forEach(function (key) {
      if (spec[key] && Object.prototype.hasOwnProperty.call(spec[key], "default")) {
        props[key] = spec[key].default;
      }
    });
    return props;
  }

  function boot() {
    var host = document.querySelector("x-dc");
    var scriptEl = document.querySelector("script[data-dc-script]");
    if (!host) {
      console.warn("[dc] no <x-dc> element found; nothing to render.");
      return;
    }

    // <helmet> holds the page's own fonts and styles — move it to <head> once,
    // and take it out of the template so it is not re-processed every render.
    var helmet = host.querySelector("helmet");
    if (helmet) {
      while (helmet.firstChild) document.head.appendChild(helmet.firstChild);
      helmet.parentNode.removeChild(helmet);
    }

    // Keep the authored template, and render into a sibling mount.
    var template = document.createElement("div");
    while (host.firstChild) template.appendChild(host.firstChild);

    var mount = document.createElement("div");
    host.parentNode.insertBefore(mount, host);
    host.parentNode.removeChild(host);

    if (!scriptEl) {
      console.warn("[dc] no <script data-dc-script> found; rendering template unbound.");
      processChildren(template, {}, mount);
      return;
    }

    var Component;
    try {
      // eslint-disable-next-line no-new-func
      Component = new Function("DCLogic", scriptEl.textContent + "\n;return Component;")(DCLogic);
    } catch (err) {
      console.error("[dc] component script failed to evaluate:", err);
      return;
    }

    var instance = new Component(readDefaultProps(scriptEl));

    function render() {
      var focus = captureFocus();
      var vals;
      try {
        vals = instance.renderVals ? instance.renderVals() : {};
      } catch (err) {
        console.error("[dc] renderVals() threw:", err);
        return;
      }
      var frag = document.createDocumentFragment();
      processChildren(template, vals || {}, frag);
      mount.textContent = "";
      mount.appendChild(frag);
      restoreFocus(focus);
    }

    instance.__rerender = render;
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
