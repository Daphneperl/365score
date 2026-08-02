/* ==========================================================================
   365Scores — Casino Welcome Offer
   Vanilla JS. No frameworks. WAAPI for the wheel; canvas-confetti on reveal.
   ========================================================================== */

(function () {
  "use strict";

  var VARIANT_KEY = "365_casino_variant";

  var FALLBACK_CONFIG = {
    settings: {
      animMs: 340,
      spinMs: 5500,
      claimDelayMs: 1500, // pause after confetti before the claim popup
      guaranteedCoins: 600,
      guaranteedSegmentId: "coins_600",
    },
    headlines: {
      A: {
        title: "Think You Can Hit\nthe Jackpot?",
        subtitle: "spin to test your luck",
      },
      B: {
        title: "Welcome Package\nUnlocked",
        subtitle: "spin to test your luck",
      },
    },
    ui: {
      spinCta: "SPIN",
      emailLabel: "Email",
      emailPlaceholder: "type anything",
      claimCta: "Claim 600 Coins Now",
      gamesTitle: "Pick a game",
    },
    wheel: {
      segments: [
        { id: "coins_100", label: "100", value: 100 },
        { id: "coins_250", label: "250", value: 250 },
        { id: "coins_600", label: "600", value: 600 },
        { id: "coins_50", label: "50", value: 50 },
        { id: "coins_500", label: "500", value: 500 },
        { id: "coins_300", label: "300", value: 300 },
      ],
    },
    prizes: [
      {
        id: "coins_600",
        title: "600 COINS UNLOCKED",
        subtitle: "Enter your email to claim your welcome balance.",
        ctaUrl: "#",
      },
    ],
    games: [
      { id: "slots", name: "Slots", image: "assets/games/slots.webp" },
      { id: "roulette", name: "Roulette", image: "assets/games/roulette.webp" },
      {
        id: "blackjack",
        name: "Blackjack",
        image: "assets/games/blackjack.webp",
      },
      { id: "poker", name: "Poker", image: "assets/games/poker.webp" },
      { id: "craps", name: "Craps", image: "assets/games/craps.webp" },
      { id: "baccarat", name: "Baccarat", image: "assets/games/baccarat.webp" },
    ],
  };

  var isSpinning = false;
  var isLocked = false;
  var hasSpun = false; // one spin per page load
  var hasClaimed = false; // one claim click per page load
  var previousEndDegree = 0;
  var spinAnimation = null;
  var spinFallbackTimer = null;
  var claimDelayTimer = null;

  var state = {
    variant: "A",
    config: null,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function settings() {
    return state.config.settings || FALLBACK_CONFIG.settings;
  }

  function ui() {
    return state.config.ui || FALLBACK_CONFIG.ui;
  }

  function setAppLocked(locked) {
    isLocked = locked;
    var app = $("app");
    if (locked) app.classList.add("is-locked");
    else app.classList.remove("is-locked");
  }

  /* ---------------- A/B variant ---------------- */

  function resolveVariant() {
    var params = new URLSearchParams(window.location.search);
    var requested = params.get("variant");
    if (requested === "A" || requested === "B") {
      try {
        sessionStorage.setItem(VARIANT_KEY, requested);
      } catch (e) {
        /* ignore */
      }
      return requested;
    }
    try {
      var stored = sessionStorage.getItem(VARIANT_KEY);
      if (stored === "A" || stored === "B") return stored;
    } catch (e) {
      /* ignore */
    }
    var assigned = Math.random() < 0.5 ? "A" : "B";
    try {
      sessionStorage.setItem(VARIANT_KEY, assigned);
    } catch (e) {
      /* ignore */
    }
    return assigned;
  }

  /* ---------------- boot ---------------- */

  function init() {
    state.variant = resolveVariant();

    fetch("data/casino-config.json", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("config request failed: " + res.status);
        return res.json();
      })
      .catch(function () {
        return FALLBACK_CONFIG;
      })
      .then(function (config) {
        state.config = config;
        boot();
      });
  }

  function boot() {
    renderHeadline();
    buildWheel();
    buildGamesMenu();
    wireControls();
    revealPage();
  }

  function revealPage() {
    var overlay = $("pageFade");
    if (!overlay || overlay.hidden) return;
    // Double-rAF so the first paint is the solid surface cover, then fade.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        fadeOverlayOut(overlay);
      });
    });
  }

  function renderHeadline() {
    var headlines = state.config.headlines || FALLBACK_CONFIG.headlines;
    var copy = headlines[state.variant] || headlines.A;
    var title = String(copy.title || "");
    // Config may use \n to force a two-line gold title.
    $("headline").innerHTML = title
      .split(/\n/)
      .map(function (line) {
        return "<span>" + line + "</span>";
      })
      .join("<br>");
    $("subheadline").textContent = copy.subtitle;
  }

  function fadeOverlayOut(overlay, onDone) {
    overlay.classList.add("is-hidden");
    overlay.addEventListener("transitionend", function handler(evt) {
      if (evt.target !== overlay) return;
      if (evt.propertyName && evt.propertyName !== "opacity") return;
      overlay.removeEventListener("transitionend", handler);
      overlay.hidden = true;
      if (typeof onDone === "function") onDone();
    });
  }

  /* ---------------- wheel ---------------- */

  function getSegments() {
    var wheel = state.config.wheel || FALLBACK_CONFIG.wheel;
    return wheel.segments || FALLBACK_CONFIG.wheel.segments;
  }

  function buildWheel() {
    var segments = getSegments();
    var list = $("wheel");
    var fieldset = $("wheelOfFortune");
    var btn = $("spinBtn");

    list.textContent = "";
    fieldset.style.setProperty("--_items", String(segments.length));

    segments.forEach(function (seg, i) {
      var li = document.createElement("li");
      li.style.setProperty("--_idx", String(i + 1));
      li.textContent = seg.label;
      li.dataset.id = seg.id;
      list.appendChild(li);
    });

    btn.textContent = ui().spinCta;
    btn.disabled = false;
  }

  function findTargetIndex(segments) {
    var id = settings().guaranteedSegmentId;
    var i;
    for (i = 0; i < segments.length; i++) {
      if (segments[i].id === id) return i;
    }
    var best = 0;
    for (i = 1; i < segments.length; i++) {
      if ((segments[i].value || 0) > (segments[best].value || 0)) best = i;
    }
    return best;
  }

  // Empirically calibrated: with this wedge geometry (transform-origin
  // center right, tip at 12 o'clock), segment i lands under the pointer
  // when the ul rotation mod 360 is (90 - i * span).
  function targetDegreeForIndex(index, count) {
    var span = 360 / count;
    return (90 - index * span + 360) % 360;
  }

  function computeEndDegree(targetIndex, count) {
    var targetMod = targetDegreeForIndex(targetIndex, count);
    var currentMod = ((previousEndDegree % 360) + 360) % 360;
    var delta = (targetMod - currentMod + 360) % 360;
    if (delta < 0.5) delta = 360;
    var fullSpins = 5;
    return previousEndDegree + fullSpins * 360 + delta;
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function onSpinComplete() {
    if (spinFallbackTimer) {
      clearTimeout(spinFallbackTimer);
      spinFallbackTimer = null;
    }
    isSpinning = false;
    setAppLocked(false);
    // Land → confetti → beat → popup
    showClaimAfterSpin();
  }

  function spinWheel() {
    if (hasSpun || isSpinning || isLocked) return;

    var segments = getSegments();
    var wheel = $("wheel");
    var btn = $("spinBtn");
    var targetIndex = findTargetIndex(segments);
    var newEndDegree = computeEndDegree(targetIndex, segments.length);
    var duration = prefersReducedMotion() ? 1 : settings().spinMs || 4000;

    hasSpun = true;
    isSpinning = true;
    setAppLocked(true);
    btn.disabled = true;

    if (spinAnimation) {
      try {
        spinAnimation.cancel();
      } catch (e) {
        /* ignore */
      }
      spinAnimation = null;
    }

    spinAnimation = wheel.animate(
      [
        { transform: "rotate(" + previousEndDegree + "deg)" },
        { transform: "rotate(" + newEndDegree + "deg)" },
      ],
      {
        duration: duration,
        direction: "normal",
        easing: "cubic-bezier(0.440, -0.205, 0.000, 1.130)",
        fill: "forwards",
        iterations: 1,
      }
    );

    previousEndDegree = newEndDegree;

    var finished = false;
    function finishOnce() {
      if (finished) return;
      finished = true;
      onSpinComplete();
    }

    spinAnimation.onfinish = finishOnce;
    if (spinFallbackTimer) clearTimeout(spinFallbackTimer);
    spinFallbackTimer = setTimeout(finishOnce, duration + 100);
  }

  /* ---------------- claim modal ---------------- */

  function getPrize() {
    var prizes = state.config.prizes || FALLBACK_CONFIG.prizes;
    var id = settings().guaranteedSegmentId;
    var i;
    for (i = 0; i < prizes.length; i++) {
      if (prizes[i].id === id) return prizes[i];
    }
    return prizes[0];
  }

  function emailReady() {
    var input = $("emailInput");
    return !!(input && input.value.trim().length >= 1);
  }

  function syncClaimEnabled() {
    var btn = $("claimBtn");
    if (!btn || hasClaimed) return;
    btn.disabled = !emailReady() || isLocked;
  }

  function populateClaimModal() {
    var prize = getPrize();
    var copy = ui();
    var input = $("emailInput");
    $("prizeTitle").textContent = prize.title;
    $("prizeSubtitle").textContent = prize.subtitle;
    $("emailLabel").textContent = copy.emailLabel;
    input.placeholder = copy.emailPlaceholder || "";
    input.value = "";
    input.disabled = false;
    $("claimBtn").textContent = copy.claimCta;
    $("claimBtn").disabled = true;
    hasClaimed = false;
  }

  function showClaimModal() {
    var modal = $("claimModal");
    var panel = modal.querySelector(".claim-modal-panel");
    modal.classList.remove("is-hidden");
    modal.hidden = false;
    if (panel) {
      panel.style.animation = "none";
      void panel.offsetWidth;
      panel.style.animation = "";
    }
    setTimeout(function () {
      var input = $("emailInput");
      if (input && !input.disabled) input.focus();
    }, 40);
  }

  function getGames() {
    var games = state.config.games || FALLBACK_CONFIG.games;
    return games && games.length ? games : FALLBACK_CONFIG.games;
  }

  function selectGameTile(tile) {
    var grid = $("gamesGrid");
    if (!grid || !tile) return;
    Array.prototype.forEach.call(grid.querySelectorAll(".game-tile"), function (btn) {
      var on = btn === tile;
      btn.classList.toggle("is-selected", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function buildGamesMenu() {
    var title = $("gamesTitle");
    var grid = $("gamesGrid");
    if (!title || !grid) return;

    title.textContent = ui().gamesTitle || "Pick a game";
    grid.textContent = "";

    getGames().forEach(function (game) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "game-tile";
      btn.dataset.gameId = game.id;
      btn.setAttribute("aria-label", game.name);
      btn.setAttribute("aria-pressed", "false");

      var img = document.createElement("img");
      img.className = "game-tile-art";
      img.src = game.image;
      img.alt = "";
      img.width = 96;
      img.height = 96;
      img.decoding = "async";
      img.loading = "lazy";

      var name = document.createElement("span");
      name.className = "game-tile-name";
      name.textContent = game.name;

      btn.addEventListener("click", function () {
        selectGameTile(btn);
      });

      btn.appendChild(img);
      btn.appendChild(name);
      grid.appendChild(btn);
    });
  }

  function showHeaderBalance() {
    var el = $("headerBalance");
    var value = $("headerBalanceValue");
    if (!el || !value) return;
    value.textContent = String(settings().guaranteedCoins || 600);
    el.hidden = false;
  }

  // One-shot scale bloom after the claim modal is fully gone.
  function bloomHeaderBalance() {
    var el = $("headerBalance");
    if (!el || el.hidden) return;
    if (prefersReducedMotion()) return;

    el.classList.remove("is-blooming");
    void el.offsetWidth;
    el.classList.add("is-blooming");
    el.addEventListener("animationend", function handler(evt) {
      if (evt.target !== el) return;
      el.removeEventListener("animationend", handler);
      el.classList.remove("is-blooming");
    });
  }

  function showGamesMenu() {
    var wheelStage = $("wheelStage");
    var menu = $("gamesMenu");
    var main = $("main");
    if (wheelStage) wheelStage.hidden = true;
    if (menu) menu.hidden = false;
    if (main) main.classList.add("is-games");
    showHeaderBalance();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function fadeClaimModalOut(onDone) {
    fadeOverlayOut($("claimModal"), onDone);
  }

  function showClaimAfterSpin() {
    if (claimDelayTimer) {
      clearTimeout(claimDelayTimer);
      claimDelayTimer = null;
    }
    populateClaimModal();
    launchConfetti();
    var delay = prefersReducedMotion() ? 0 : settings().claimDelayMs || 1500;
    claimDelayTimer = setTimeout(function () {
      claimDelayTimer = null;
      showClaimModal();
    }, delay);
  }

  function launchConfetti() {
    if (typeof confetti !== "function") return;
    if (prefersReducedMotion()) return;

    var count = 200;
    // Above .claim-modal (z-index: 120) so bursts render in front of the popup.
    var defaults = { origin: { y: 0.7 }, zIndex: 200 };

    function fire(particleRatio, opts) {
      confetti(
        Object.assign({}, defaults, opts, {
          particleCount: Math.floor(count * particleRatio),
        })
      );
    }

    fire(0.25, { spread: 26, startVelocity: 55 });
    fire(0.2, { spread: 60 });
    fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    fire(0.1, { spread: 120, startVelocity: 45 });
  }

  /* ---------------- controls ---------------- */

  function claimCoins() {
    if (hasClaimed || isLocked || !emailReady()) return;

    // Email is only checked client-side (≥1 char). Nothing is stored or sent.
    hasClaimed = true;
    var input = $("emailInput");
    var btn = $("claimBtn");
    input.disabled = true;
    btn.disabled = true;
    // Swap to games under the modal first — otherwise the wheel flashes
    // through during the fade. Bloom the header coins only after the fade ends.
    buildGamesMenu();
    showGamesMenu();
    fadeClaimModalOut(bloomHeaderBalance);
  }

  function wireControls() {
    $("spinBtn").addEventListener("click", function (evt) {
      evt.preventDefault();
      spinWheel();
    });

    var email = $("emailInput");
    email.addEventListener("input", syncClaimEnabled);
    email.addEventListener("keydown", function (evt) {
      if (evt.key === "Enter") {
        evt.preventDefault();
        claimCoins();
      }
    });

    $("claimBtn").addEventListener("click", function (evt) {
      evt.preventDefault();
      claimCoins();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
