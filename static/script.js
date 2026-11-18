/* =========================================================
   CINEBOT 3.0
   SEARCH + ADVANCED FILTERS + PAGINATION
   Uses status.js for badges and countdowns when it is loaded.
========================================================= */

"use strict";

/* =========================================================
   GLOBAL STATE
========================================================= */

let selectedCategory = "movie";
let filterGenresLoadedFor = null;
let currentStudioResults = [];

let currentPage = 1;
let currentSearchQuery = "";
let currentMode = "search";
let currentTotalPages = 1;

// Each new search or filter run gets an ID. Responses from older runs are ignored.
let searchRequestId = 0;
let filterRequestId = 0;

const RESULTS_PER_PAGE = 20;
const MAX_VISIBLE_PAGES = 5;

// The backend does not support studio filtering yet, so the field stays hidden.
const STUDIO_FILTER_ENABLED = false;


/* =========================================================
   DOM HELPERS
========================================================= */

function byId(id) {
    return document.getElementById(id);
}

function setFilterMessage(message, isError = false) {
    const element = byId("filterMessage");

    if (!element) return;

    element.textContent = message;
    element.style.color = isError ? "#ff8585" : "#9CBBC1";
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function selectedValues(containerId) {
    const container = byId(containerId);

    if (!container) return [];

    return Array.from(
        container.querySelectorAll('input[type="checkbox"]:checked')
    ).map(input => input.value);
}

function addQueryValue(params, key, value) {
    if (value !== null && value !== undefined && value !== "") {
        params.set(key, value);
    }
}


/* =========================================================
   API HELPER
========================================================= */

async function fetchJSON(url) {
    const response = await fetch(url, {
        headers: {
            "Accept": "application/json"
        }
    });

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error("The server returned an invalid response.");
    }

    if (!response.ok) {
        throw new Error(
            data?.error ||
            data?.message ||
            `Request failed (${response.status}).`
        );
    }

    return data;
}


/* =========================================================
   CATEGORY SELECTION
========================================================= */

function selectCategory(category, button = null) {
    const allowedCategories = ["movie", "tv", "anime"];

    if (!allowedCategories.includes(category)) {
        console.warn("Invalid category:", category);
        return;
    }

    const categoryChanged = selectedCategory !== category;

    selectedCategory = category;

    currentPage = 1;
    currentSearchQuery = "";
    currentMode = "search";
    currentTotalPages = 1;

    document.querySelectorAll(".category-button").forEach(item => {
        const isActive =
            item.dataset.category === category ||
            item === button;

        item.classList.toggle("active", isActive);
        item.setAttribute("aria-pressed", String(isActive));
    });

    updateFilterFields();
    configureSortOptions();

    if (categoryChanged || filterGenresLoadedFor !== category) {
        loadCategoryFilters();
    }
}


/* =========================================================
   SEARCH SHORTCUTS
========================================================= */

function selectAndSearch(category, query) {
    selectCategory(category);

    const input = byId("searchInput");

    if (input) {
        input.value = query;
    }

    searchContent(1);
}

function quickSearch(query) {
    const input = byId("searchInput");

    if (input) {
        input.value = query;
    }

    searchContent(1);
}


/* =========================================================
   FILTER FIELD VISIBILITY
========================================================= */

function updateFilterFields() {
    const isAnime = selectedCategory === "anime";
    const isTV = selectedCategory === "tv";

    const visibility = {
        yearField: true,
        ratingField: true,
        votesField: !isAnime,
        languageField: !isAnime,
        countryField: !isAnime,
        tvStatusField: isTV,

        animeTagsField: isAnime,
        animeFormatField: isAnime,
        animeStatusField: isAnime,
        animeSeasonField: isAnime,
        animeStudioField: isAnime && STUDIO_FILTER_ENABLED
    };

    // The HTML uses the hidden attribute, so set .hidden rather than inline display.
    Object.entries(visibility).forEach(([id, visible]) => {
        const element = byId(id);

        if (element) {
            element.hidden = !visible;
        }
    });
}


/* =========================================================
   SORT OPTIONS
========================================================= */

function configureSortOptions() {
    const sortSelect = byId("filterSort");

    if (!sortSelect) return;

    const previousValue = sortSelect.value;

    const options = selectedCategory === "anime"
        ? [
            ["POPULARITY_DESC", "Most Popular"],
            ["SCORE_DESC", "Highest Rated"],
            ["TRENDING_DESC", "Trending"],
            ["START_DATE_DESC", "Recently Released"],
            ["FAVOURITES_DESC", "Most Favourited"]
        ]
        : [
            ["popularity.desc", "Most Popular"],
            ["vote_average.desc", "Highest Rated"],
            ["primary_release_date.desc", "Newest Releases"],
            ["revenue.desc", "Highest Revenue"],
            ["vote_count.desc", "Most Voted"]
        ];

    sortSelect.innerHTML = options.map(([value, label]) => `
        <option value="${escapeHTML(value)}">
            ${escapeHTML(label)}
        </option>
    `).join("");

    if (options.some(option => option[0] === previousValue)) {
        sortSelect.value = previousValue;
    }
}


/* =========================================================
   LOAD CATEGORY FILTERS
========================================================= */

async function loadCategoryFilters() {
    const category = selectedCategory;

    const genreContainer = byId("genreOptions");
    const tagContainer = byId("tagOptions");

    if (genreContainer) {
        genreContainer.innerHTML = "<span>Loading genres...</span>";
    }

    if (tagContainer) {
        tagContainer.innerHTML = "<span>Loading tags...</span>";
    }

    try {
        const url = category === "anime"
            ? "/api/anime/filters"
            : `/api/filters/${encodeURIComponent(category)}`;

        const data = await fetchJSON(url);

        // Ignore the response if the user has switched categories since the request started.
        if (category !== selectedCategory) return;

        renderCheckboxOptions("genreOptions", data.genres || [], "genre");

        if (category === "anime") {
            // Tags are sent to the backend by name, so use the name as the value.
            const tags = (data.tags || []).map(tag => ({
                id: tag.name,
                name: tag.name
            }));

            renderCheckboxOptions("tagOptions", tags, "tag");
        } else if (tagContainer) {
            tagContainer.innerHTML = "";
        }

        filterGenresLoadedFor = category;

    } catch (error) {
        console.error("Filter loading error:", error);

        if (genreContainer) {
            genreContainer.innerHTML =
                '<span class="filter-error">Unable to load genres.</span>';
        }

        if (tagContainer) {
            tagContainer.innerHTML = "";
        }

        setFilterMessage(error.message, true);
    }
}


/* =========================================================
   RENDER CHECKBOX OPTIONS
========================================================= */

function renderCheckboxOptions(containerId, options, prefix) {
    const container = byId(containerId);

    if (!container) return;

    if (!Array.isArray(options) || options.length === 0) {
        container.innerHTML =
            '<span class="anime-muted">No options available.</span>';
        return;
    }

    container.innerHTML = options.map(option => {
        const value = typeof option === "string"
            ? option
            : option?.id ?? option?.name ?? option?.value ?? "";

        const label = typeof option === "string"
            ? option
            : option?.name ?? option?.label ?? value;

        if (!value || !label) return "";

        const safeValue = escapeHTML(value);
        const safeLabel = escapeHTML(label);
        const id = `${prefix}-${String(value).replace(/[^a-zA-Z0-9_-]/g, "-")}`;

        return `
            <label for="${escapeHTML(id)}">
                <input
                    type="checkbox"
                    id="${escapeHTML(id)}"
                    name="${prefix}"
                    value="${safeValue}"
                >
                <span>${safeLabel}</span>
            </label>
        `;
    }).join("");
}


/* =========================================================
   ANIME STUDIO SEARCH
   (kept for later; the field is hidden while the backend
   does not filter by studio)
========================================================= */

async function findStudioId() {
    const input = byId("filterStudio");
    const suggestions = byId("studioSuggestions");
    const hiddenInput = byId("filterStudioId");

    if (!input || !suggestions) return;

    const query = input.value.trim();

    if (hiddenInput) {
        hiddenInput.value = "";
    }

    currentStudioResults = [];

    if (query.length < 2) {
        suggestions.innerHTML = "";
        return;
    }

    try {
        const params = new URLSearchParams({ q: query });

        const data = await fetchJSON(`/api/anime/studios?${params.toString()}`);

        const studios = Array.isArray(data)
            ? data
            : data.results || data.studios || [];

        currentStudioResults = studios;

        suggestions.innerHTML = studios.map(studio => `
            <option value="${escapeHTML(studio.name)}"
                    data-studio-id="${escapeHTML(studio.id)}">
            </option>
        `).join("");

    } catch (error) {
        console.error("Studio search error:", error);
        suggestions.innerHTML = "";
    }
}

function selectStudioId() {
    const input = byId("filterStudio");
    const hiddenInput = byId("filterStudioId");

    if (!input || !hiddenInput) return;

    const selected = currentStudioResults.find(studio =>
        studio.name?.toLowerCase() === input.value.trim().toLowerCase()
    );

    hiddenInput.value = selected?.id || "";
}


/* =========================================================
   LOADING AND EMPTY STATES
========================================================= */

function showLoading(message = "Finding your next favourite...") {
    const results = byId("results");

    if (!results) return;

    results.innerHTML = `
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <h3>${escapeHTML(message)}</h3>
            <p>Please wait while CineBot loads your results.</p>
        </div>
    `;
}

function showEmptyState(message = "No results found.") {
    const results = byId("results");

    if (!results) return;

    results.innerHTML = `
        <div class="empty-state">
            <h3>No Results Found</h3>
            <p>${escapeHTML(message)}</p>
        </div>
    `;
}


/* =========================================================
   RESULT HELPERS
========================================================= */

function getResultImage(item) {
    const image =
        item.poster ||
        item.poster_path ||
        item.coverImage?.large ||
        item.coverImage?.extraLarge ||
        item.image ||
        "";

    if (!image) return "";

    if (image.startsWith("http")) {
        return image;
    }

    return `https://image.tmdb.org/t/p/w500${image}`;
}

function getResultTitle(item) {
    if (typeof item.title === "string") {
        return item.title;
    }

    return item.title?.english ||
        item.title?.userPreferred ||
        item.title?.romaji ||
        item.name ||
        item.original_title ||
        "Untitled";
}

function getResultYear(item) {
    return item.year ||
        item.release_date?.slice(0, 4) ||
        item.first_air_date?.slice(0, 4) ||
        item.seasonYear ||
        "Unknown";
}

function getResultRating(item) {
    const rating = Number(
        item.rating ?? item.vote_average ?? item.averageScore
    );

    if (!Number.isFinite(rating) || rating <= 0) {
        return "N/A";
    }

    // AniList scores are out of 100; TMDB scores are out of 10.
    return (rating > 10 ? rating / 10 : rating).toFixed(1);
}


/* =========================================================
   STATUS BADGE AND COUNTDOWN (from status.js)
   Both return empty text if status.js did not load.
========================================================= */

function resultStatusHTML(item) {
    if (typeof cbStatusBadge !== "function") return "";

    return cbStatusBadge(item.status);
}

function resultNextEpisodeHTML(item, category) {
    if (category === "anime" && typeof cbNextEpisodeLine === "function") {
        return cbNextEpisodeLine(item.nextAiringEpisode);
    }

    if (category === "tv" && typeof cbTvNextEpisodeLine === "function") {
        return cbTvNextEpisodeLine(item.next_episode_to_air);
    }

    return "";
}


/* =========================================================
   RESULT CARD
========================================================= */

function createMovieCard(item, category = selectedCategory) {
    const title = getResultTitle(item);
    const image = getResultImage(item);
    const year = getResultYear(item);
    const rating = getResultRating(item);

    const itemId = item.id;

    const detailsURL = category === "anime"
        ? `/anime/${encodeURIComponent(itemId)}`
        : `/details/${encodeURIComponent(category)}/${encodeURIComponent(itemId)}`;

    const posterHTML = image
        ? `
            <img
                src="${escapeHTML(image)}"
                alt="${escapeHTML(title)} poster"
                loading="lazy"
                onerror="this.style.display='none'"
            >
        `
        : `
            <div class="result-placeholder">
                <span>🎬</span>
                <small>No Poster</small>
            </div>
        `;

    return `
        <article class="result-card"
                 data-item-id="${escapeHTML(itemId)}"
                 tabindex="0"
                 onclick="window.location.href='${escapeHTML(detailsURL)}'"
                 onkeydown="if(event.key==='Enter'){window.location.href='${escapeHTML(detailsURL)}'}">

            <div class="result-poster">
                ${posterHTML}
            </div>

            <div class="result-info">

                <h3 class="result-title">
                    ${escapeHTML(title)}
                </h3>

                <div class="result-meta">
                    ${escapeHTML(year)}
                </div>

                <div class="card-rating">
                    ★ ${escapeHTML(rating)}
                </div>

                ${resultStatusHTML(item)}
                ${resultNextEpisodeHTML(item, category)}

            </div>

        </article>
    `;
}


/* =========================================================
   FLAT RESULTS
========================================================= */

function renderFlatResults(items, totalResults = null) {
    const results = byId("results");

    if (!results) return;

    if (!Array.isArray(items) || items.length === 0) {
        showEmptyState("Try another search or adjust your filters.");
        return;
    }

    results.innerHTML = `
        <div class="results-header">
            <h2 class="section-title">Search Results</h2>
            <span class="results-count">
                ${escapeHTML(totalResults ?? items.length)} results
            </span>
        </div>

        <div class="results-grid">
            ${items.map(item => createMovieCard(item, selectedCategory)).join("")}
        </div>

        <div id="paginationContainer"></div>
    `;
}


/* =========================================================
   ANIME SEARCH RESULTS
========================================================= */

function renderAnimeResults(data) {
    const results = byId("results");

    if (!results) return;

    const allResults = [
        ...(Array.isArray(data.series) ? data.series : []),
        ...(Array.isArray(data.movies) ? data.movies : []),
        ...(Array.isArray(data.other) ? data.other : [])
    ];

    if (allResults.length === 0) {
        showEmptyState("No anime matched your search.");
        return;
    }

    results.innerHTML = `
        <div class="results-header">
            <h2 class="section-title">Anime Search Results</h2>
            <span class="results-count">
                ${allResults.length} results on this page
            </span>
        </div>

        <div class="results-grid">
            ${allResults.map(item => createMovieCard(item, "anime")).join("")}
        </div>

        <div id="paginationContainer"></div>
    `;
}


/* =========================================================
   PAGINATION
========================================================= */

function renderPagination(current, totalPages, onPageChange) {
    const container = byId("paginationContainer");

    if (!container) return;

    const total = Math.max(1, Number(totalPages) || 1);
    const page = Math.min(Math.max(1, Number(current) || 1), total);

    currentTotalPages = total;

    if (total <= 1) {
        container.innerHTML = "";
        return;
    }

    const start = Math.max(
        1,
        Math.min(
            page - Math.floor(MAX_VISIBLE_PAGES / 2),
            total - MAX_VISIBLE_PAGES + 1
        )
    );

    const end = Math.min(total, start + MAX_VISIBLE_PAGES - 1);

    let buttons = `
        <button class="pagination-button"
                ${page === 1 ? "disabled" : ""}
                data-page="${page - 1}">
            ←
        </button>
    `;

    if (start > 1) {
        buttons += `<button class="pagination-button" data-page="1">1</button>`;

        if (start > 2) {
            buttons += `<span class="pagination-info">...</span>`;
        }
    }

    for (let number = start; number <= end; number++) {
        buttons += `
            <button
                class="pagination-button ${number === page ? "active" : ""}"
                data-page="${number}"
                ${number === page ? 'aria-current="page"' : ""}
            >
                ${number}
            </button>
        `;
    }

    if (end < total) {
        if (end < total - 1) {
            buttons += `<span class="pagination-info">...</span>`;
        }

        buttons += `<button class="pagination-button" data-page="${total}">${total}</button>`;
    }

    buttons += `
        <button class="pagination-button"
                ${page === total ? "disabled" : ""}
                data-page="${page + 1}">
            →
        </button>
    `;

    container.innerHTML = `
        <div class="pagination-wrapper">
            <div class="cinebot-pagination">
                ${buttons}
            </div>

            <span class="pagination-info">
                Page ${page} of ${total}
            </span>
        </div>
    `;

    container.querySelectorAll("[data-page]").forEach(button => {
        button.addEventListener("click", () => {
            const nextPage = Number(button.dataset.page);

            if (
                Number.isInteger(nextPage) &&
                nextPage >= 1 &&
                nextPage <= total &&
                nextPage !== page
            ) {
                onPageChange(nextPage);
            }
        });
    });
}


/* =========================================================
   TOTAL PAGE COUNT
========================================================= */

function getTotalPages(data, page) {
    let totalPages = 1;

    if (selectedCategory === "anime") {
        const pageInfo = data.pageInfo || {};

        if (pageInfo.lastPage) {
            totalPages = Number(pageInfo.lastPage);
        } else if (pageInfo.total && pageInfo.perPage) {
            totalPages = Math.ceil(Number(pageInfo.total) / Number(pageInfo.perPage));
        } else if (pageInfo.hasNextPage) {
            totalPages = page + 1;
        }
    } else {
        totalPages = Number(data.total_pages || data.totalPages || 1);
    }

    return Math.max(1, Math.min(totalPages, 500));
}


/* =========================================================
   SEARCH CONTENT
========================================================= */

async function searchContent(page = 1) {
    const input = byId("searchInput");
    const query = input?.value.trim() || "";

    if (!query) {
        if (input) input.focus();
        showEmptyState("Enter a title to start discovering.");
        return;
    }

    const requestId = ++searchRequestId;

    currentPage = page;
    currentSearchQuery = query;
    currentMode = "search";

    showLoading("Searching CineBot...");

    try {
        const params = new URLSearchParams({
            q: query,
            page: String(page)
        });

        let data;

        if (selectedCategory === "anime") {
            data = await fetchJSON(`/api/anime/search?${params.toString()}`);

            if (requestId !== searchRequestId) return;

            renderAnimeResults(data);
        } else {
            params.set("category", selectedCategory);

            data = await fetchJSON(`/api/search?${params.toString()}`);

            if (requestId !== searchRequestId) return;

            const items = data.results || [];

            renderFlatResults(
                items,
                data.total_results ?? data.totalResults ?? items.length
            );
        }

        renderPagination(page, getTotalPages(data, page), nextPage => {
            searchContent(nextPage);
        });

    } catch (error) {
        if (requestId !== searchRequestId) return;

        console.error("Search error:", error);

        showEmptyState(error.message || "Something went wrong while searching.");
    }
}


/* =========================================================
   BUILD FILTER PARAMETERS
========================================================= */

function buildFilterParams(page = 1) {
    const params = new URLSearchParams();

    params.set("page", String(page));
    params.set("per_page", String(RESULTS_PER_PAGE));

    const genres = selectedValues("genreOptions");

    if (genres.length) {
        params.set("genres", genres.join(","));
    }

    addQueryValue(params, "year", byId("filterYear")?.value);
    addQueryValue(params, "rating", byId("filterRating")?.value);

    const sort = byId("filterSort")?.value;

    if (selectedCategory === "anime") {
        const tags = selectedValues("tagOptions");

        if (tags.length) {
            params.set("tags", tags.join(","));
        }

        addQueryValue(params, "sort", sort);
        addQueryValue(params, "format", byId("filterAnimeFormat")?.value);
        addQueryValue(params, "status", byId("filterAnimeStatus")?.value);
        addQueryValue(params, "season", byId("filterAnimeSeason")?.value);

    } else {
        // TMDB reads sort_by, not sort.
        addQueryValue(params, "sort_by", sort);
        addQueryValue(params, "with_original_language", byId("filterLanguage")?.value);
        addQueryValue(params, "country", byId("filterCountry")?.value);
        addQueryValue(params, "votes", byId("filterVotes")?.value);

        if (selectedCategory === "tv") {
            addQueryValue(params, "status", byId("filterTvStatus")?.value);
        }
    }

    return params;
}


/* =========================================================
   APPLY FILTERS
========================================================= */

async function applyFilters(page = 1) {
    const requestId = ++filterRequestId;

    currentPage = page;
    currentMode = "filters";
    currentSearchQuery = "";

    showLoading("Finding titles that match your filters...");
    setFilterMessage("Applying your filters...");

    try {
        const params = buildFilterParams(page);

        const endpoint = selectedCategory === "anime"
            ? "/api/anime/discover"
            : `/api/discover/${encodeURIComponent(selectedCategory)}`;

        const data = await fetchJSON(`${endpoint}?${params.toString()}`);

        if (requestId !== filterRequestId) return;

        const items = data.results || [];

        if (items.length === 0) {
            showEmptyState("Try changing your selected genres, year or rating.");
            setFilterMessage("No matching titles found.");
            return;
        }

        renderFlatResults(
            items,
            data.total_results ?? data.totalResults ?? items.length
        );

        renderPagination(page, getTotalPages(data, page), nextPage => {
            applyFilters(nextPage);
        });

        setFilterMessage(`${items.length} titles found. Filters applied successfully.`);

    } catch (error) {
        if (requestId !== filterRequestId) return;

        console.error("Filter error:", error);

        showEmptyState(error.message || "Unable to apply filters.");
        setFilterMessage(error.message, true);
    }
}


/* =========================================================
   CLEAR FILTERS
========================================================= */

function clearFilters() {
    const ids = [
        "filterYear",
        "filterRating",
        "filterLanguage",
        "filterCountry",
        "filterVotes",
        "filterTvStatus",
        "filterAnimeFormat",
        "filterAnimeStatus",
        "filterAnimeSeason",
        "filterStudio",
        "filterStudioId"
    ];

    ids.forEach(id => {
        const element = byId(id);

        if (element) {
            element.value = "";
        }
    });

    ["genreOptions", "tagOptions"].forEach(id => {
        const container = byId(id);

        if (!container) return;

        container.querySelectorAll('input[type="checkbox"]').forEach(input => {
            input.checked = false;
        });
    });

    const suggestions = byId("studioSuggestions");

    if (suggestions) {
        suggestions.innerHTML = "";
    }

    currentStudioResults = [];
    currentPage = 1;

    setFilterMessage("All filters cleared.");

    configureSortOptions();
}


/* =========================================================
   INITIALIZATION
========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    const searchButton = byId("searchButton");
    const searchInput = byId("searchInput");
    const applyButton = byId("applyFiltersButton");
    const clearButton = byId("clearFiltersButton");
    const studioInput = byId("filterStudio");

    if (searchButton) {
        searchButton.addEventListener("click", () => {
            searchContent(1);
        });
    }

    if (searchInput) {
        searchInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                searchContent(1);
            }
        });
    }

    if (applyButton) {
        applyButton.addEventListener("click", () => {
            applyFilters(1);
        });
    }

    if (clearButton) {
        clearButton.addEventListener("click", clearFilters);
    }

    if (studioInput && STUDIO_FILTER_ENABLED) {
        studioInput.addEventListener("input", findStudioId);
        studioInput.addEventListener("change", selectStudioId);
        studioInput.addEventListener("blur", selectStudioId);
    }

    document.querySelectorAll(".category-button").forEach(button => {
        button.addEventListener("click", () => {
            selectCategory(button.dataset.category, button);
        });
    });

    updateFilterFields();
    configureSortOptions();
    loadCategoryFilters();

    console.log("CineBot 3.0 JavaScript loaded successfully.");
});


/* =========================================================
   GLOBAL FUNCTIONS FOR HTML
========================================================= */

window.selectCategory = selectCategory;
window.selectAndSearch = selectAndSearch;
window.quickSearch = quickSearch;
window.searchContent = searchContent;
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;
window.findStudioId = findStudioId;