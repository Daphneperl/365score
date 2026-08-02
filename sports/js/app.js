/* ==========================================================================
   365Scores — Build Your Matchday
   Vanilla JS. No frameworks, no animation libraries.
   ========================================================================== */

(function () {
  "use strict";

  var ANIM_MS = 340;        // must be >= CSS var(--anim), used as the input-lock window
  var BUILDING_MS = 4000;   // "Making it yours" overlay after Build My Feed
  var LOADER_FADE_MS = 500; // let the wave settle before fading the loader in
  var FEED_MIN = 14;        // pad the reveal feed so it never looks sparse
  var loaderFadeTimer = null;

  // Minimal inline fallback so the page still functions if config.json
  // can't be fetched (e.g. opened directly via file:// without a server).
  var FALLBACK_CONFIG = {
    headlines: {
      A: { title: "Your matches. Your way.", subtitle: "Pick your teams to get started." },
      B: { title: "Everyone's Saturday looks different.", subtitle: "Pick your teams to get started." }
    },
    sports: [{
      id: "football", name: "Football", icon: "⚽",
      leagues: [{
        id: "epl", name: "Premier League",
        teams: [
          { id: "ars", name: "Arsenal", short: "ARS", color: "#EF0107" },
          { id: "che", name: "Chelsea", short: "CHE", color: "#034694" }
        ]
      }]
    }],
    fixtures: [{ home: "ars", away: "che", homeScore: 1, awayScore: 1, status: "LIVE 40'", competition: "Premier League" }]
  };

  // TheSportsDB's shared public test key ("3") — free, no signup, rate-limited.
  // Used to progressively enhance team crests and surface real live football
  // scores. Every call here fails silently: if the API is slow, rate-limited,
  // or doesn't recognize a team, the page just keeps its CSS-drawn fallback.
  var SPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json/3";
  var badgeCache = {};

  var state = {
    variant: "A",
    config: null,
    teamMap: {},
    selectedSports: new Set(),
    selectedLeagues: new Set(),
    selectedTeams: new Set(),
    locked: false,
    prefsSaved: false
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- A/B variant ---------------- */
  // ?variant=A|B always wins (explicit override for QA/links). Otherwise a
  // variant already assigned this session is reused — a reload shouldn't
  // reshuffle someone mid-session. Failing both, it's a random 50/50 split,
  // persisted so the rest of the session stays on the same variant.
  var VARIANT_KEY = "ms_ab_variant";

  function resolveVariant() {
    var params = new URLSearchParams(window.location.search);
    var requested = params.get("variant");
    if (requested === "A" || requested === "B") {
      sessionStorage.setItem(VARIANT_KEY, requested);
      return requested;
    }
    var stored = sessionStorage.getItem(VARIANT_KEY);
    if (stored === "A" || stored === "B") return stored;
    var assigned = Math.random() < 0.5 ? "A" : "B";
    sessionStorage.setItem(VARIANT_KEY, assigned);
    return assigned;
  }

  function pushDataLayer(event, data) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: event, variant: state.variant }, data || {}));
  }

  /* ---------------- boot ---------------- */

  function init() {
    state.variant = resolveVariant();
    pushDataLayer("ab_variant_assigned");

    // No automatic timer: tapping (or Enter/Space on) the overlay is the
    // only way it dismisses. Data loading and dismissal are independent —
    // the title renders the instant config is ready (not gated behind any
    // wait), and a tap that arrives before data is ready just gets queued,
    // firing the moment it becomes available rather than being dropped.
    var ready = false;
    var wantsReveal = false;
    var overlay = $("introOverlay");

    function tryReveal() {
      if (!ready || !wantsReveal) return;
      overlay.removeEventListener("click", onTap);
      overlay.removeEventListener("keydown", onKey);
      revealApp();
    }
    function onTap() { pushDataLayer("intro_tap"); wantsReveal = true; tryReveal(); }
    function onKey(evt) {
      if (evt.key === "Enter" || evt.key === " ") { evt.preventDefault(); onTap(); }
    }
    overlay.addEventListener("click", onTap);
    overlay.addEventListener("keydown", onKey);

    fetch("data/config.json", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("config.json request failed: " + res.status);
        return res.json();
      })
      .catch(function () { return FALLBACK_CONFIG; })
      .then(function (config) {
        state.config = config;
        state.teamMap = buildTeamMap();
        boot();
        ready = true;
        tryReveal();
      });
  }

  function boot() {
    renderHeadline();
    renderSportsStep();
    wireStaticControls();
    setProgress(25);
    $("main").classList.add("center-step");
    // Built and ready the moment data loads — the overlay is the only thing
    // still covering it, and only a tap takes that away.
    $("main").hidden = false;
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

  // Fades an overlay out, then removes it from layout once the transition
  // finishes so it can't be interacted with mid-fade.
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

  // Fades the title overlay out to reveal the already-built step 1 underneath.
  function revealApp() {
    fadeOverlayOut($("introOverlay"));
  }

  // Mirror of fadeOverlayOut: start at opacity 0, then transition in.
  function fadeOverlayIn(overlay) {
    overlay.classList.add("is-hidden");
    overlay.hidden = false;
    // Force a layout pass so the browser commits opacity:0 before we flip
    // to opacity:1 — otherwise the transition is skipped.
    void overlay.offsetWidth;
    overlay.classList.remove("is-hidden");
  }

  function showBuildingOverlay() {
    var overlay = $("buildingOverlay");
    var loader = overlay.querySelector(".feed-loader");
    if (loaderFadeTimer) {
      clearTimeout(loaderFadeTimer);
      loaderFadeTimer = null;
    }
    if (loader) loader.classList.remove("is-visible");
    fadeOverlayIn(overlay);
    // Wave keyframes look jagged at t=0 — hide them for a beat, then fade in
    // once the cycle is already underway.
    loaderFadeTimer = setTimeout(function () {
      loaderFadeTimer = null;
      if (loader) loader.classList.add("is-visible");
    }, LOADER_FADE_MS);
  }

  // Preloading the entire 114-team/28-league catalog on every page load was
  // the previous approach, but it fires far more requests than TheSportsDB's
  // free shared key tolerates in a burst (confirmed: it 429s well before
  // that many). Instead, warming starts the moment a sport is tapped in step
  // 1 — scoped to just that sport's leagues/teams, so what actually gets
  // requested tracks what the user is likely to reach, not the whole app.
  // All calls share one running schedule (not one timer each) so tapping
  // several sports back-to-back doesn't multiply the burst rate.
  var nextPreloadAt = 0;
  function schedulePreload(fn) {
    var now = Date.now();
    nextPreloadAt = Math.max(nextPreloadAt, now) + STAGGER_MS;
    setTimeout(fn, nextPreloadAt - now);
  }

  function preloadSport(sport) {
    sport.leagues.forEach(function (league) {
      schedulePreload(function () { fetchLeagueBadge(league, sport.id).then(warmImage); });
      league.teams.forEach(function (team) {
        schedulePreload(function () { fetchTeamBadge(team).then(warmImage); });
      });
    });
  }

  // Warm the actual image bytes so crests don't pop in after the overlay
  // fades — fetchTeamBadge only caches the URL string.
  function warmImage(url) {
    if (!url) return;
    var img = new Image();
    img.src = url;
  }

  // During the "Making it yours" beat, resolve + warm badges for everything
  // the user picked so the feed/crests swap in from cache on reveal.
  function preloadSelectedLogos() {
    state.config.sports.forEach(function (sport) {
      if (!state.selectedSports.has(sport.id)) return;
      sport.leagues.forEach(function (league) {
        if (!state.selectedLeagues.has(league.id)) return;
        schedulePreload(function () {
          fetchLeagueBadge(league, sport.id).then(warmImage);
        });
        league.teams.forEach(function (team) {
          if (!state.selectedTeams.has(team.id)) return;
          schedulePreload(function () {
            fetchTeamBadge(team).then(warmImage);
          });
        });
      });
    });
  }

  function setProgress(pct) {
    var filledCount = Math.round(pct / 25);
    document.querySelectorAll(".progress-seg").forEach(function (seg, i) {
      seg.classList.toggle("filled", i < filledCount);
    });
  }

  /* ---------------- external API: real crest images (progressive enhancement) ---------------- */

  var badgeInFlight = {};

  // A short display name ("Dortmund", "PSG", "Inter") is often too generic
  // for TheSportsDB's exact-ish name search — "Dortmund" alone matches an
  // amateur club, not Borussia Dortmund; "PSG" matches an esports org, not
  // Paris Saint-Germain. searchName lets a config entry override the query
  // string without changing what's displayed. The sport check below is a
  // second, general-purpose backstop for teams that haven't been audited.
  function fetchTeamBadge(team) {
    if (badgeCache[team.id] !== undefined) return Promise.resolve(badgeCache[team.id]);
    if (badgeInFlight[team.id]) return badgeInFlight[team.id];
    var expectedSport = SPORTSDB_SPORT_MATCH[state.teamSport[team.id]];
    var query = team.searchName || team.name;
    var p = fetch(SPORTSDB_BASE + "/searchteams.php?t=" + encodeURIComponent(query))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var match = data && data.teams && data.teams[0];
        var sportMatches = match && expectedSport && (match.strSport || "").toLowerCase().indexOf(expectedSport) !== -1;
        var badge = (sportMatches && match.strBadge) || null;
        badgeCache[team.id] = badge;
        return badge;
      })
      .catch(function () {
        badgeCache[team.id] = null;
        return null;
      });
    badgeInFlight[team.id] = p;
    return p;
  }

  // Requests are staggered rather than fired all at once: TheSportsDB's
  // free shared test key rate-limits under burst load, and a step with 20+
  // teams would otherwise fire 20+ simultaneous requests on render.
  var STAGGER_MS = 120;
  function staggeredEach(items, fn) {
    items.forEach(function (item, i) { setTimeout(function () { fn(item); }, i * STAGGER_MS); });
  }

  // Team crests start with an inline `style="background:<color>"` (the CSS
  // shorthand), which also implicitly resets background-size/repeat/position
  // to their defaults *as part of that same inline declaration* — those
  // implicit inline values beat an external stylesheet rule no matter its
  // specificity. So every sub-property has to be set inline here too, or the
  // image silently fails to render even though it loaded fine.
  function applyBadge(el, badgeUrl) {
    el.style.backgroundImage = "url('" + badgeUrl + "')";
    el.style.backgroundColor = "transparent";
    el.style.backgroundSize = "72%";
    el.style.backgroundRepeat = "no-repeat";
    el.style.backgroundPosition = "center";
    el.classList.add("has-badge");
    el.textContent = "";
  }

  // Crests render immediately as CSS-colored initials (never blocked on the
  // network); any real badge that resolves afterward swaps in in-place.
  function upgradeCrests(container, teams) {
    staggeredEach(teams, function (team) {
      fetchTeamBadge(team).then(function (badgeUrl) {
        if (!badgeUrl) return;
        container.querySelectorAll('[data-team-id="' + team.id + '"]').forEach(function (el) {
          applyBadge(el, badgeUrl);
        });
      });
    });
  }

  // TheSportsDB has no lookup-by-league-name endpoint on the free tier, so a
  // league's logo is resolved indirectly: search a representative team, read
  // the league id off it, then look the league up by id. strSport is checked
  // against the sport we expect, because some club names (e.g. "CSKA Moscow",
  // "Toulouse") exist under more than one sport in their database and the
  // wrong match would silently show the wrong badge. If the league's first
  // team collides with a same-named club in another sport, the second team
  // is tried before giving up.
  var leagueBadgeCache = {};
  var SPORTSDB_SPORT_MATCH = {
    football: "soccer", basketball: "basketball", nfl: "american football",
    baseball: "baseball", hockey: "ice hockey", rugby: "rugby",
    cricket: "cricket", volleyball: "volleyball", esports: "esports"
  };

  // Sport-category alone isn't enough to disambiguate: a generic nickname
  // like "49ers" can resolve to a COLLEGE team (NCAA Division 1) that still
  // correctly reports sport "American Football", passing the sport check
  // while being the wrong league entirely — that's how the NFL card ended
  // up showing NCAA's badge. The hard backstop: once a TheSportsDB league id
  // has been claimed by one of our config leagues, no other config league
  // may also claim it — better to show no logo than the same wrong one on
  // two different cards.
  var claimedSportsDbLeagueIds = {};

  function resolveLeagueViaTeam(teamName, expectedSport, ourLeagueId) {
    return fetch(SPORTSDB_BASE + "/searchteams.php?t=" + encodeURIComponent(teamName))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var team = data && data.teams && data.teams[0];
        var sportMatches = team && expectedSport && (team.strSport || "").toLowerCase().indexOf(expectedSport) !== -1;
        if (!team || !team.idLeague || !sportMatches) return null;
        var claimedBy = claimedSportsDbLeagueIds[team.idLeague];
        if (claimedBy && claimedBy !== ourLeagueId) return null;
        return fetch(SPORTSDB_BASE + "/lookupleague.php?id=" + team.idLeague)
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (data) {
            var lg = data && data.leagues && data.leagues[0];
            var badge = (lg && lg.strBadge) || null;
            if (badge) claimedSportsDbLeagueIds[team.idLeague] = ourLeagueId;
            return badge;
          });
      });
  }

  function fetchLeagueBadge(league, sportId) {
    if (leagueBadgeCache[league.id] !== undefined) return Promise.resolve(leagueBadgeCache[league.id]);
    var expectedSport = SPORTSDB_SPORT_MATCH[sportId];
    var candidates = (league.teams || []).slice(0, 3);
    if (candidates.length === 0) return Promise.resolve(null);

    return candidates.reduce(function (chain, team) {
      return chain.then(function (found) {
        if (found) return found;
        return resolveLeagueViaTeam(team.name, expectedSport, league.id).catch(function () { return null; });
      });
    }, Promise.resolve(null)).then(function (badge) {
      leagueBadgeCache[league.id] = badge;
      return badge;
    });
  }

  function upgradeLeagueBadges(container, leagues) {
    staggeredEach(leagues, function (league) {
      fetchLeagueBadge(league, league.sportId).then(function (badgeUrl) {
        if (!badgeUrl) return;
        container.querySelectorAll('[data-league-id="' + league.id + '"]').forEach(function (el) {
          applyBadge(el, badgeUrl);
        });
      });
    });
  }

  function buildTeamMap() {
    var map = {};
    state.footballTeamIds = new Set();
    state.teamSport = {};
    state.config.sports.forEach(function (sport) {
      sport.leagues.forEach(function (league) {
        league.teams.forEach(function (team) {
          map[team.id] = team;
          state.teamSport[team.id] = sport.id;
          if (sport.id === "football") state.footballTeamIds.add(team.id);
        });
      });
    });
    return map;
  }

  /* ---------------- A/B headline ---------------- */

  function renderHeadline() {
    var copy = state.config.headlines[state.variant] || state.config.headlines.A;
    $("headline").textContent = copy.title;
    $("subheadline").textContent = copy.subtitle;
  }

  /* ---------------- step transitions (double-click / spam-tap guard) ---------------- */

  function goToStep(hideId, showId, progressPct) {
    if (state.locked) return;
    state.locked = true;
    document.getElementById("app").classList.add("is-locked");

    $(hideId).hidden = true;
    var showEl = $(showId);
    showEl.hidden = false;
    // restart the CSS entrance animation
    showEl.classList.remove("step");
    void showEl.offsetWidth;
    showEl.classList.add("step");

    setProgress(progressPct);
    // The feed is the destination, not another step — no more progress bar,
    // and no forced vertical centering on what's long-form scrolling content.
    var isReveal = showId === "step-reveal";
    $("progressDock").hidden = isReveal;
    $("main").classList.toggle("center-step", !isReveal);
    window.scrollTo({ top: 0, behavior: "smooth" });

    setTimeout(function () {
      state.locked = false;
      document.getElementById("app").classList.remove("is-locked");
    }, ANIM_MS);
  }

  function safeClick(fn) {
    return function (evt) {
      if (state.locked) return;
      fn(evt);
    };
  }

  /* ---------------- step 1: sports ---------------- */

  function renderSportsStep() {
    var grid = $("sportsGrid");
    grid.innerHTML = "";
    state.config.sports.forEach(function (sport) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (state.selectedSports.has(sport.id) ? " selected" : "");
      chip.innerHTML = '<span class="icon">' + sport.icon + "</span>" + sport.name;
      chip.addEventListener("click", safeClick(function () {
        toggleSetItem(state.selectedSports, sport.id, chip);
        $("toStep2").disabled = state.selectedSports.size === 0;
        if (state.selectedSports.has(sport.id)) preloadSport(sport);
      }));
      grid.appendChild(chip);
    });
    $("toStep2").disabled = state.selectedSports.size === 0;
  }

  function toggleSetItem(set, id, el) {
    el.classList.toggle("selected");
    if (set.has(id)) set.delete(id); else set.add(id);
  }

  /* ---------------- step 2: leagues ---------------- */

  function renderLeaguesStep() {
    var container = $("leaguesGrid");
    container.innerHTML = "";

    var sportGroups = [];
    var allLeagues = [];
    state.config.sports.forEach(function (sport) {
      if (!state.selectedSports.has(sport.id)) return;
      var sportLeagues = sport.leagues.map(function (league) {
        return { id: league.id, name: league.name, icon: sport.icon, sportId: sport.id, teams: league.teams };
      });
      sportGroups.push({ sport: sport, leagues: sportLeagues });
      allLeagues = allLeagues.concat(sportLeagues);
    });

    var validIds = new Set(allLeagues.map(function (l) { return l.id; }));
    Array.from(state.selectedLeagues).forEach(function (id) {
      if (!validIds.has(id)) state.selectedLeagues.delete(id);
    });

    // Grouped by sport — a thin divider (sport icon + name) precedes each
    // sport's own league grid, rather than one flat mixed grid.
    sportGroups.forEach(function (group) {
      container.appendChild(sectionDivider(group.sport.icon, group.sport.name));

      var grid = document.createElement("div");
      grid.className = "league-grid";
      group.leagues.forEach(function (league) {
        var card = document.createElement("button");
        card.type = "button";
        card.className = "league-badge" + (state.selectedLeagues.has(league.id) ? " selected" : "");
        card.innerHTML =
          '<span class="league-icon" data-league-id="' + league.id + '">' + league.icon + "</span>" +
          '<span class="league-name">' + league.name + "</span>";
        card.addEventListener("click", safeClick(function () {
          toggleSetItem(state.selectedLeagues, league.id, card);
          $("toStep3").disabled = state.selectedLeagues.size === 0;
        }));
        grid.appendChild(card);
      });
      container.appendChild(grid);
    });

    $("toStep3").disabled = state.selectedLeagues.size === 0;
    upgradeLeagueBadges(container, allLeagues);
  }

  // A thin divider row: icon + label + a hairline filling the rest of the
  // width. `iconEl` is the actual element used for the icon so callers can
  // attach data-* hooks (e.g. to swap in a real league logo).
  function sectionDivider(icon, label, extraIconClass, dataAttr) {
    var el = document.createElement("div");
    el.className = "section-divider";
    el.innerHTML =
      '<span class="section-divider-icon' + (extraIconClass ? " " + extraIconClass : "") + '"' +
        (dataAttr ? " " + dataAttr : "") + ">" + icon + "</span>" +
      '<span class="section-divider-label">' + label + "</span>" +
      '<span class="section-divider-line"></span>';
    return el;
  }

  /* ---------------- step 3: teams ---------------- */

  function renderTeamsStep() {
    var container = $("teamsGrid");
    container.innerHTML = "";

    var leagueGroups = [];
    var allTeams = [];
    state.config.sports.forEach(function (sport) {
      sport.leagues.forEach(function (league) {
        if (!state.selectedLeagues.has(league.id)) return;
        leagueGroups.push({ id: league.id, name: league.name, icon: sport.icon, sportId: sport.id, teams: league.teams });
        allTeams = allTeams.concat(league.teams);
      });
    });

    var validIds = new Set(allTeams.map(function (t) { return t.id; }));
    Array.from(state.selectedTeams).forEach(function (id) {
      if (!validIds.has(id)) state.selectedTeams.delete(id);
    });

    // Grouped by league — a thin divider (real league logo once resolved,
    // sport icon until then) precedes each league's own team grid.
    leagueGroups.forEach(function (group) {
      container.appendChild(sectionDivider(group.icon, group.name, "league-icon", 'data-league-id="' + group.id + '"'));

      var grid = document.createElement("div");
      grid.className = "team-grid";
      group.teams.forEach(function (team) {
        var card = document.createElement("button");
        card.type = "button";
        card.className = "team-badge" + (state.selectedTeams.has(team.id) ? " selected" : "");
        card.innerHTML =
          '<span class="team-crest" data-team-id="' + team.id + '" style="background:' + team.color + '">' + team.short + "</span>" +
          '<span class="team-name">' + team.name + "</span>";
        card.addEventListener("click", safeClick(function () {
          toggleSetItem(state.selectedTeams, team.id, card);
          updateTeamCount();
        }));
        grid.appendChild(card);
      });
      container.appendChild(grid);
    });

    updateTeamCount();
    upgradeCrests(container, allTeams);
    upgradeLeagueBadges(container, leagueGroups);
  }

  function updateTeamCount() {
    $("teamCount").textContent = state.selectedTeams.size;
    $("toReveal").disabled = state.selectedTeams.size === 0;
  }

  /* ---------------- step 4: reveal ---------------- */

  // 0 = live / in progress, 1 = finished, 2 = upcoming
  function fixtureBucket(f) {
    var s = f.status || "";
    if (/^LIVE\b/i.test(s) || /^Q[1-4]\b/i.test(s)) return 0;
    if (f.homeScore === null || f.homeScore === undefined) return 2;
    return 1;
  }

  function parseClockMinutes(status) {
    var m = String(status).match(/(\d{1,2}):(\d{2})/);
    if (!m) return 0;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  // Lower = more "current" within the live bucket (later in the match first).
  function liveSortKey(status) {
    var s = String(status);
    var minute = s.match(/LIVE\s+(\d+)/i);
    if (minute) return -parseInt(minute[1], 10);
    if (/Q4|P3|7th|18\./i.test(s)) return -90;
    if (/Q3|P2/i.test(s)) return -60;
    if (/Q2|P1/i.test(s)) return -30;
    if (/Q1/i.test(s)) return -10;
    return 0;
  }

  // Lower = sooner kickoff among upcoming statuses in config.
  function upcomingSortKey(status) {
    var s = String(status);
    var lower = s.toLowerCase();
    var time = parseClockMinutes(s);
    var dayOffset;

    if (lower.indexOf("today") === 0 || lower.indexOf("tonight") === 0) {
      dayOffset = 0;
    } else if (lower.indexOf("tomorrow") === 0) {
      dayOffset = 1;
    } else {
      var days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      var match = s.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/i);
      if (match) {
        var target = days.indexOf(match[1].toLowerCase());
        var today = new Date().getDay();
        dayOffset = (target - today + 7) % 7;
      } else {
        dayOffset = 98;
      }
    }
    return dayOffset * 10000 + time;
  }

  function compareFixtures(a, b) {
    var bucketDiff = fixtureBucket(a) - fixtureBucket(b);
    if (bucketDiff !== 0) return bucketDiff;

    var bucket = fixtureBucket(a);
    if (bucket === 0) return liveSortKey(a.status) - liveSortKey(b.status);
    if (bucket === 2) return upcomingSortKey(a.status) - upcomingSortKey(b.status);
    // Finished: keep later catalog entries (treated as more recent) first.
    return state.config.fixtures.indexOf(b) - state.config.fixtures.indexOf(a);
  }

  // Prefer the user's teams, pad to FEED_MIN, then sort the whole feed:
  // live → finished (latest first) → upcoming (closer → farther).
  function buildFeedFixtures() {
    var mine = [];
    var others = [];
    state.config.fixtures.forEach(function (f) {
      if (state.selectedTeams.has(f.home) || state.selectedTeams.has(f.away)) {
        mine.push(f);
      } else {
        others.push(f);
      }
    });

    var fixtures = mine.slice();
    for (var i = 0; i < others.length && fixtures.length < FEED_MIN; i++) {
      fixtures.push(others[i]);
    }
    fixtures.sort(compareFixtures);
    return fixtures;
  }

  function buildReveal() {
    var fixtures = buildFeedFixtures();

    var list = $("fixtureList");
    list.innerHTML = "";

    if (fixtures.length === 0) {
      var empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No fixtures for your teams right now — check back soon.";
      list.appendChild(empty);
    } else {
      fixtures.forEach(function (f, i) {
        var home = state.teamMap[f.home];
        var away = state.teamMap[f.away];
        if (!home || !away) return;
        var isLive = f.status.indexOf("LIVE") === 0;
        var isUpcoming = f.homeScore === null || f.homeScore === undefined;
        var statusClass = isLive ? " live" : "";
        // Upcoming games already show their kickoff time in the score slot
        // below — repeating it up here too was pure duplication.
        var statusLabel = isUpcoming ? "" : (isLive ? f.status : "Match ended");

        var card = document.createElement("div");
        card.className = "fixture-card" + (isUpcoming ? " is-upcoming" : "");
        card.style.animationDelay = (i * 60) + "ms";
        card.innerHTML =
          (statusLabel ? '<span class="fixture-status' + statusClass + '">' + statusLabel + "</span>" : "") +
          '<div class="fixture-match">' +
            '<div class="fixture-side home">' +
              '<span class="mini-crest" data-team-id="' + home.id + '" style="background:' + home.color + '">' + home.short + "</span>" +
              '<span class="fixture-team-name">' + home.name + "</span>" +
            "</div>" +
            (isUpcoming
              ? '<span class="fixture-kickoff">' + f.status + "</span>"
              : '<span class="fixture-score-block"><span class="fixture-score">' + f.homeScore + '</span><span class="fixture-score-sep">-</span><span class="fixture-score">' + f.awayScore + "</span></span>") +
            '<div class="fixture-side away">' +
              '<span class="mini-crest" data-team-id="' + away.id + '" style="background:' + away.color + '">' + away.short + "</span>" +
              '<span class="fixture-team-name">' + away.name + "</span>" +
            "</div>" +
          "</div>";
        list.appendChild(card);
      });

      var feedTeams = [];
      var seen = {};
      fixtures.forEach(function (f) {
        [f.home, f.away].forEach(function (id) {
          if (seen[id] || !state.teamMap[id]) return;
          seen[id] = true;
          feedTeams.push(state.teamMap[id]);
        });
      });
      upgradeCrests(list, feedTeams);
    }

    renderLivePanel();
  }

  // canvas-confetti "realistic look" burst (library loaded via CDN).
  function launchConfetti() {
    if (typeof confetti !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var count = 200;
    var defaults = { origin: { y: 0.7 } };

    function fire(particleRatio, opts) {
      confetti(Object.assign({}, defaults, opts, {
        particleCount: Math.floor(count * particleRatio)
      }));
    }

    fire(0.25, { spread: 26, startVelocity: 55 });
    fire(0.2, { spread: 60 });
    fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    fire(0.1, { spread: 120, startVelocity: 45 });
  }

  /* ---------------- external API: real live football scores ---------------- */

  function renderLivePanel() {
    var panel = $("livePanel");
    var list = $("liveList");
    panel.hidden = true;
    list.innerHTML = "";

    var footballTeams = Array.from(state.selectedTeams)
      .map(function (id) { return state.teamMap[id]; })
      .filter(function (t) { return t && state.footballTeamIds.has(t.id); });
    if (footballTeams.length === 0) return;

    var nameLookup = {};
    footballTeams.forEach(function (t) { nameLookup[t.name.toLowerCase()] = t; });

    var today = new Date().toISOString().slice(0, 10);
    fetch(SPORTSDB_BASE + "/eventsday.php?d=" + today + "&s=Soccer")
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var events = (data && data.events) || [];
        var matches = events.filter(function (e) {
          return nameLookup[(e.strHomeTeam || "").toLowerCase()] || nameLookup[(e.strAwayTeam || "").toLowerCase()];
        });
        if (matches.length === 0) return;

        matches.slice(0, 5).forEach(function (e) {
          var isLive = e.strStatus && e.strStatus !== "Match Finished" && e.strStatus !== "Not Started" && e.strStatus !== "";
          var isFinished = e.strStatus === "Match Finished";
          var hasScore = e.intHomeScore !== null && e.intHomeScore !== undefined;

          var kickoff = (e.strTimeLocal || e.strTime || "").slice(0, 5) || "Today";
          var statusLabel = isFinished ? "Match ended" : (isLive ? (e.strStatus || "Live") : "");

          var card = document.createElement("div");
          card.className = "fixture-card" + (!hasScore ? " is-upcoming" : "");
          card.innerHTML =
            (statusLabel ? '<span class="fixture-status' + (isLive ? " live" : "") + '">' + statusLabel + "</span>" : "") +
            '<div class="fixture-match">' +
              '<div class="fixture-side home"><span class="fixture-team-name">' + e.strHomeTeam + "</span></div>" +
              (hasScore
                ? '<span class="fixture-score-block"><span class="fixture-score">' + e.intHomeScore + '</span><span class="fixture-score-sep">-</span><span class="fixture-score">' + e.intAwayScore + "</span></span>"
                : '<span class="fixture-kickoff">' + kickoff + "</span>") +
              '<div class="fixture-side away"><span class="fixture-team-name">' + e.strAwayTeam + "</span></div>" +
            "</div>";
          list.appendChild(card);
        });

        if (list.children.length > 0) panel.hidden = false;
      })
      .catch(function () { /* leave panel hidden — this is enrichment, not a dependency */ });
  }

  /* ---------------- save preferences modal ---------------- */

  function emailReady() {
    var input = $("emailInput");
    return !!(input && input.value.trim().length >= 1);
  }

  function syncSaveEnabled() {
    var btn = $("savePrefsBtn");
    if (!btn || state.prefsSaved) return;
    btn.disabled = !emailReady() || state.locked;
  }

  function resetSaveModal() {
    var input = $("emailInput");
    var btn = $("savePrefsBtn");
    if (input) {
      input.value = "";
      input.disabled = false;
    }
    if (btn) {
      btn.textContent = "Save preferences";
      btn.disabled = true;
    }
    state.prefsSaved = false;
    var dock = $("saveDock");
    if (dock) dock.hidden = false;
  }

  function showSaveModal() {
    var modal = $("saveModal");
    var panel = modal.querySelector(".save-modal-panel");
    var input = $("emailInput");
    if (input) {
      input.value = "";
      input.disabled = false;
    }
    $("savePrefsBtn").disabled = true;
    modal.classList.remove("is-hidden");
    modal.hidden = false;
    if (panel) {
      panel.style.animation = "none";
      void panel.offsetWidth;
      panel.style.animation = "";
    }
    setTimeout(function () {
      if (input && !input.disabled) input.focus();
    }, 40);
  }

  function savePreferences() {
    if (state.prefsSaved || state.locked || !emailReady()) return;

    // Email is only checked client-side (≥1 char). Nothing is stored or sent.
    state.prefsSaved = true;
    var input = $("emailInput");
    var btn = $("savePrefsBtn");
    if (input) input.disabled = true;
    if (btn) btn.disabled = true;
    pushDataLayer("preferences_saved");
    fadeOverlayOut($("saveModal"), function () {
      var dock = $("saveDock");
      if (dock) dock.hidden = true;
    });
  }

  /* ---------------- static control wiring (runs once) ---------------- */

  function wireStaticControls() {
    $("toStep2").addEventListener("click", safeClick(function () {
      renderLeaguesStep();
      goToStep("step-sports", "step-leagues", 50);
    }));

    $("backTo1").addEventListener("click", safeClick(function () {
      goToStep("step-leagues", "step-sports", 25);
    }));

    $("toStep3").addEventListener("click", safeClick(function () {
      renderTeamsStep();
      goToStep("step-leagues", "step-teams", 75);
    }));

    $("backTo2").addEventListener("click", safeClick(function () {
      goToStep("step-teams", "step-leagues", 50);
    }));

    $("toReveal").addEventListener("click", safeClick(function () {
      pushDataLayer("onboarding_complete", { teamCount: state.selectedTeams.size });
      showBuildingOverlay();
      preloadSelectedLogos();
      // Keep input locked for the full beat so a second tap can't queue
      // another reveal while the overlay is up.
      state.locked = true;
      document.getElementById("app").classList.add("is-locked");
      // Hold the beat, then build + swap underneath and fade into the feed
      // so card entrances run when the user can actually see them.
      setTimeout(function () {
        state.locked = false;
        document.getElementById("app").classList.remove("is-locked");
        buildReveal();
        goToStep("step-teams", "step-reveal", 100);
        fadeOverlayOut($("buildingOverlay"), launchConfetti);
      }, BUILDING_MS);
    }));

    $("startOver").addEventListener("click", safeClick(function () {
      state.selectedSports.clear();
      state.selectedLeagues.clear();
      state.selectedTeams.clear();
      resetSaveModal();
      var modal = $("saveModal");
      if (modal && !modal.hidden) {
        modal.classList.add("is-hidden");
        modal.hidden = true;
      }
      renderSportsStep();
      goToStep("step-reveal", "step-sports", 25);
    }));

    $("openSaveModal").addEventListener("click", safeClick(function () {
      if (state.prefsSaved) return;
      showSaveModal();
    }));

    var email = $("emailInput");
    email.addEventListener("input", syncSaveEnabled);
    email.addEventListener("keydown", function (evt) {
      if (evt.key === "Enter") {
        evt.preventDefault();
        savePreferences();
      }
    });

    $("savePrefsBtn").addEventListener("click", function (evt) {
      evt.preventDefault();
      savePreferences();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
