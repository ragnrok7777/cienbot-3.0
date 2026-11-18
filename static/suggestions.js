/* =========================================================
   CINEBOT 3.0 — LIVE SEARCH SUGGESTIONS
   Shows matching titles under the search bar while typing.
   Anime, movies and TV shows all use the same row layout:
   poster, title, coloured status, and a type/year/episodes line.
========================================================= */

(function () {
    "use strict";

    const MAX_SUGGESTIONS = 6;
    const DEBOUNCE_MS = 300;
    const MIN_CHARACTERS = 2;

    let box = null;
    let timer = null;
    let requestId = 0;
    let activeIndex = -1;
    let entries = [];

    /* -----------------------------------------------------
       STYLES (added here so no CSS file needs editing)
    ----------------------------------------------------- */

    const style = document.createElement("style");

    style.textContent = `
        .cb-suggestions {
            width: 100%;
            max-width: 620px;
            margin: 12px 0 0;
            background: #111a24;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
        }

        .cb-suggestions[hidden] {
            display: none;
        }

        .cb-suggestion {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 12px 14px;
            color: #E9FCFF;
            text-decoration: none;
            border-bottom: 1px dashed rgba(255, 255, 255, 0.08);
            cursor: pointer;
        }

        .cb-suggestion:last-of-type {
            border-bottom: 0;
        }

        .cb-suggestion:hover,
        .cb-suggestion.active {
            background: rgba(53, 224, 208, 0.08);
        }

        .cb-suggestion img,
        .cb-suggestion-noimg {
            width: 62px;
            height: 88px;
            flex: 0 0 62px;
            object-fit: cover;
            border-radius: 6px;
            background: #1b2a37;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .cb-suggestion-text {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
        }

        .cb-suggestion-title {
            font-size: 16px;
            font-weight: 700;
            line-height: 1.25;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .cb-suggestion-status {
            font-size: 14px;
            font-weight: 600;
        }

        .cb-suggestion-meta {
            font-size: 13px;
            color: #9CBBC1;
        }

        .cb-suggestion-empty {
            padding: 14px;
            color: #9CBBC1;
        }

        .cb-suggestion-all {
            width: 100%;
            padding: 12px 14px;
            border: 0;
            background: transparent;
            color: #35E0D0;
            font-weight: 700;
            text-align: left;
            cursor: pointer;
        }

        .cb-suggestion-all:hover {
            background: rgba(53, 224, 208, 0.08);
        }
    `;

    document.head.appendChild(style);

    /* -----------------------------------------------------
       HELPERS
    ----------------------------------------------------- */

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[char]);
    }

    function currentCategory() {
        return typeof selectedCategory !== "undefined" ? selectedCategory : "movie";
    }

    function titleOf(item) {
        if (typeof item.title === "string") return item.title;

        return item.title?.english ||
            item.title?.romaji ||
            item.title?.native ||
            item.name ||
            item.original_title ||
            "Untitled";
    }

    function yearOf(item) {
        return item.year ||
            item.release_date?.slice(0, 4) ||
            item.first_air_date?.slice(0, 4) ||
            item.seasonYear ||
            "";
    }

    function detailsURL(item, category) {
        if (category === "anime") {
            return `/anime/${encodeURIComponent(item.id)}`;
        }

        return `/details/${encodeURIComponent(category)}/${encodeURIComponent(item.id)}`;
    }

    // Status text and colour for anime and TV.
    // Values come from AniList (anime) or are converted by app.py (TV).
    function statusInfo(status) {
        const map = {
            RELEASING: { label: "Currently Airing", color: "#2ECC71" },
            FINISHED: { label: "Finished Airing", color: "#9CBBC1" },
            NOT_YET_RELEASED: { label: "Upcoming", color: "#F5A623" },
            CANCELLED: { label: "Cancelled", color: "#E74C3C" },
            HIATUS: { label: "On Hiatus", color: "#F5A623" }
        };

        return map[status] || null;
    }

    // Movies don't have a status in the search results, so use the release date.
    function movieStatus(item) {
        if (!item.release_date) return null;

        const released = new Date(`${item.release_date}T00:00:00`) <= new Date();

        return released
            ? { label: "Released", color: "#9CBBC1" }
            : { label: "Upcoming", color: "#F5A623" };
    }

    function statusFor(item, category) {
        if (category === "movie") return movieStatus(item);

        return statusInfo(item.status);
    }

    function formatLabel(format) {
        const names = {
            TV: "TV",
            TV_SHORT: "TV Short",
            MOVIE: "Movie",
            SPECIAL: "Special",
            OVA: "OVA",
            ONA: "ONA",
            MUSIC: "Music"
        };

        return names[format] || format || "";
    }

    // Same pattern for all three: type • year • episodes (anime only).
    // Examples: "• TV • 2026 • 12 eps", "• TV Show • 2024", "• Movie • 2016".
    function metaLine(item, category) {
        const parts = [];

        if (category === "anime") {
            parts.push(formatLabel(item.format) || "Anime");
        } else if (category === "tv") {
            parts.push("TV Show");
        } else {
            parts.push("Movie");
        }

        const year = yearOf(item);

        if (year) parts.push(year);

        if (category === "anime" && item.format !== "MOVIE" && item.episodes) {
            parts.push(`${item.episodes} eps`);
        }

        return `• ${parts.join(" • ")}`;
    }

    function input() {
        return document.getElementById("searchInput");
    }

    /* -----------------------------------------------------
       FETCH SUGGESTIONS
    ----------------------------------------------------- */

    async function fetchSuggestions(query, category) {
        const encoded = encodeURIComponent(query);

        if (category === "anime") {
            const response = await fetch(`/api/anime/search?q=${encoded}&page=1`);
            const data = await response.json();

            if (!response.ok) throw new Error(data.error || "Search failed.");

            return [
                ...(data.series || []),
                ...(data.movies || []),
                ...(data.other || [])
            ]
                .slice(0, MAX_SUGGESTIONS)
                .map(item => ({ item, category: "anime" }));
        }

        const response = await fetch(`/api/search?q=${encoded}&category=${category}&page=1`);
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || "Search failed.");

        return (data.results || [])
            .slice(0, MAX_SUGGESTIONS)
            .map(item => ({ item, category }));
    }

    /* -----------------------------------------------------
       RENDER
    ----------------------------------------------------- */

    function hideBox() {
        if (box) box.hidden = true;
        activeIndex = -1;
    }

    function renderBox(query, results) {
        if (!box) return;

        entries = results;
        activeIndex = -1;

        if (!results.length) {
            box.innerHTML = `
                <div class="cb-suggestion-empty">
                    No matches for "${esc(query)}"
                </div>
            `;
            box.hidden = false;
            return;
        }

        const rows = results.map((entry, index) => {
            const { item, category } = entry;
            const image = item.poster || "";
            const status = statusFor(item, category);

            const thumb = image
                ? `<img src="${esc(image)}" alt="">`
                : `<span class="cb-suggestion-noimg">🎬</span>`;

            const statusLine = status
                ? `<span class="cb-suggestion-status" style="color:${status.color}">${esc(status.label)}</span>`
                : "";

            return `
                <a class="cb-suggestion"
                   data-index="${index}"
                   href="${esc(detailsURL(item, category))}">
                    ${thumb}
                    <span class="cb-suggestion-text">
                        <span class="cb-suggestion-title">${esc(titleOf(item))}</span>
                        ${statusLine}
                        <span class="cb-suggestion-meta">${esc(metaLine(item, category))}</span>
                    </span>
                </a>
            `;
        }).join("");

        box.innerHTML = `
            ${rows}
            <button type="button" class="cb-suggestion-all">
                See all results for "${esc(query)}" →
            </button>
        `;

        box.hidden = false;
    }

    function highlight(index) {
        if (!box) return;

        const rows = box.querySelectorAll(".cb-suggestion");

        rows.forEach(row => row.classList.remove("active"));

        if (index >= 0 && index < rows.length) {
            rows[index].classList.add("active");
            rows[index].scrollIntoView({ block: "nearest" });
        }

        activeIndex = index;
    }

    /* -----------------------------------------------------
       LOAD (debounced, ignores old responses)
    ----------------------------------------------------- */

    async function load(query) {
        const currentRequest = ++requestId;

        if (query.length < MIN_CHARACTERS) {
            hideBox();
            return;
        }

        if (box) {
            box.innerHTML = `<div class="cb-suggestion-empty">Searching...</div>`;
            box.hidden = false;
        }

        try {
            const results = await fetchSuggestions(query, currentCategory());

            if (currentRequest !== requestId) return;

            renderBox(query, results);

        } catch (error) {
            if (currentRequest !== requestId) return;

            console.error("Suggestion error:", error);
            hideBox();
        }
    }

    function scheduleLoad() {
        clearTimeout(timer);

        const query = input()?.value.trim() || "";

        timer = setTimeout(() => load(query), DEBOUNCE_MS);
    }

    /* -----------------------------------------------------
       SETUP
    ----------------------------------------------------- */

    function setup() {
        const searchInput = input();
        const section = document.getElementById("searchSection");

        if (!searchInput || !section) return;

        box = document.createElement("div");
        box.id = "searchSuggestions";
        box.className = "cb-suggestions";
        box.hidden = true;

        section.insertAdjacentElement("afterend", box);

        searchInput.setAttribute("autocomplete", "off");

        searchInput.addEventListener("input", scheduleLoad);

        searchInput.addEventListener("focus", () => {
            if (entries.length && searchInput.value.trim().length >= MIN_CHARACTERS) {
                box.hidden = false;
            }
        });

        // Capture phase runs before script.js, so arrow keys and Enter
        // can pick a suggestion without also starting a full search.
        document.addEventListener("keydown", event => {
            if (event.target !== searchInput || box.hidden) return;

            const rows = box.querySelectorAll(".cb-suggestion");

            if (event.key === "ArrowDown") {
                event.preventDefault();
                highlight(Math.min(activeIndex + 1, rows.length - 1));
                return;
            }

            if (event.key === "ArrowUp") {
                event.preventDefault();
                highlight(Math.max(activeIndex - 1, 0));
                return;
            }

            if (event.key === "Escape") {
                hideBox();
                return;
            }

            if (event.key === "Enter" && activeIndex >= 0 && entries[activeIndex]) {
                event.preventDefault();
                event.stopPropagation();

                const { item, category } = entries[activeIndex];
                window.location.href = detailsURL(item, category);
            }
        }, true);

        // "See all results" runs the normal search.
        box.addEventListener("click", event => {
            if (event.target.closest(".cb-suggestion-all")) {
                event.preventDefault();
                hideBox();

                if (typeof window.searchContent === "function") {
                    window.searchContent(1);
                }
            }
        });

        // Hide when clicking anywhere else.
        document.addEventListener("click", event => {
            if (!box.contains(event.target) && event.target !== searchInput) {
                hideBox();
            }
        });

        // Refresh suggestions when the category changes.
        document.querySelectorAll(".category-button").forEach(button => {
            button.addEventListener("click", () => {
                setTimeout(() => {
                    const query = searchInput.value.trim();

                    if (query.length >= MIN_CHARACTERS) {
                        load(query);
                    } else {
                        hideBox();
                    }
                }, 0);
            });
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setup);
    } else {
        setup();
    }

})();