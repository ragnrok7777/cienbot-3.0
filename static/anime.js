/* =========================================================
   CINEBOT 3.0 — ANIME DETAILS PAGE
   Self-contained: does not depend on status.js.
========================================================= */

"use strict";

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

// AniList descriptions contain HTML such as <br> and <i>, and sometimes encoded
// entities such as &#039;. Convert the line breaks, strip the tags, then decode
// the entities using a textarea (which never runs scripts).
function cleanDescription(html) {
    if (!html) return "No description available.";

    const withBreaks = String(html).replace(/<br\s*\/?>/gi, "\n");
    const withoutTags = withBreaks.replace(/<[^>]*>/g, "");

    const decoder = document.createElement("textarea");
    decoder.innerHTML = withoutTags;

    return decoder.value.trim() || "No description available.";
}

// Builds a HiAnime search link for the anime title.
function hianimeSearchURL(title) {
    return `https://hianimes.se/search?keyword=${encodeURIComponent(title)}`;
}

function formatStartDate(startDate) {
    if (!startDate || !startDate.year) return "Unknown";

    const month = startDate.month
        ? String(startDate.month).padStart(2, "0")
        : null;

    return month
        ? `${startDate.year}-${month}`
        : String(startDate.year);
}

function formatList(items) {
    return items && items.length ? items.join(", ") : "Not available";
}

function formatFormat(format) {
    if (!format) return "Unknown";

    const names = {
        TV: "TV Series",
        TV_SHORT: "TV Short",
        MOVIE: "Movie",
        SPECIAL: "Special",
        OVA: "OVA",
        ONA: "ONA",
        MUSIC: "Music"
    };

    return names[format] || format;
}

function formatStatus(status) {
    if (!status) return "Unknown";

    const names = {
        RELEASING: "Airing",
        FINISHED: "Completed",
        NOT_YET_RELEASED: "Upcoming",
        CANCELLED: "Cancelled",
        HIATUS: "On Hiatus"
    };

    return names[status] || status;
}

function formatScore(score) {
    if (score === null || score === undefined) return "Not rated";

    return `${(Number(score) / 10).toFixed(1)}/10`;
}

// Green = airing, red = finished or cancelled, amber = upcoming or on hiatus.
function statusBadgeHTML(status) {
    const classes = {
        RELEASING: "status-airing",
        FINISHED: "status-finished",
        CANCELLED: "status-finished",
        NOT_YET_RELEASED: "status-upcoming",
        HIATUS: "status-upcoming"
    };

    const cls = classes[status] || "status-upcoming";

    return `
        <span class="status-badge ${cls}">
            <span class="status-dot-live"></span>
            ${escapeHTML(formatStatus(status))}
        </span>
    `;
}

// Turns seconds into text such as "in 2d 5h" or "in 40m".
function countdownText(seconds) {
    if (seconds <= 0) return "airing now";

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `in ${days}d ${hours}h`;
    if (hours > 0) return `in ${hours}h ${minutes}m`;

    return `in ${minutes}m`;
}

// Shows the next episode's number, countdown and local date/time.
// Returns an empty string when AniList has no schedule for the show.
function nextEpisodeHTML(next) {
    if (!next || !next.airingAt) return "";

    const airDate = new Date(next.airingAt * 1000);
    const seconds = Math.floor((airDate.getTime() - Date.now()) / 1000);

    const when = airDate.toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
    });

    return `
        <p class="next-episode">
            Episode ${escapeHTML(Number(next.episode))} airs ${countdownText(seconds)} · ${escapeHTML(when)}
        </p>
    `;
}

function renderError(container, message) {
    container.innerHTML = `
        <div class="details-error">
            <h2>Something went wrong</h2>
            <p>${escapeHTML(message)}</p>
            <button type="button" onclick="loadAnimeDetails()">
                Try Again
            </button>
            <a href="/">← Back to Search</a>
        </div>
    `;
}

function renderLoading(container) {
    container.innerHTML = `
        <div class="details-loading">
            <div class="loading-spinner"></div>
            <h2>Loading anime details...</h2>
            <p>Preparing your anime experience.</p>
        </div>
    `;
}

function renderAnime(container, anime) {
    const title =
        anime.title?.english ||
        anime.title?.romaji ||
        anime.title?.native ||
        "Untitled";

    const subtitle =
        anime.title?.native && anime.title.native !== title
            ? anime.title.native
            : anime.title?.romaji && anime.title.romaji !== title
                ? anime.title.romaji
                : "";

    const cover =
        anime.coverImage?.extraLarge ||
        anime.coverImage?.large ||
        "";

    const banner = anime.bannerImage || "";

    const genres = (anime.genres || []).join(", ");

    const studios = (anime.studios?.nodes || [])
        .map(studio => studio.name)
        .filter(Boolean);

    const duration = anime.duration
        ? `${anime.duration} min per episode`
        : "Not available";

    const episodes = anime.episodes ?? "Unknown";

    const season = anime.season && anime.seasonYear
        ? `${anime.season.charAt(0)}${anime.season.slice(1).toLowerCase()} ${anime.seasonYear}`
        : "Not available";

    const trailer =
        anime.trailer?.site?.toLowerCase() === "youtube" && anime.trailer?.id
            ? `https://www.youtube.com/watch?v=${encodeURIComponent(anime.trailer.id)}`
            : "";

    const story = cleanDescription(anime.description);

    const watchURL = hianimeSearchURL(title);

    const bannerStyle = banner
        ? `style="background-image: linear-gradient(90deg, #06131C 5%, #06131Cdd 65%, #06131C88), url('${escapeHTML(banner)}')"`
        : "";

    container.innerHTML = `
        ${banner ? `<div class="details-backdrop" ${bannerStyle}></div>` : ""}

        <section class="movie-hero">

            <div class="poster-container">
                ${cover
                    ? `<img class="movie-poster" src="${escapeHTML(cover)}" alt="${escapeHTML(title)} cover">`
                    : `<div class="poster-placeholder">COVER UNAVAILABLE</div>`
                }
            </div>

            <div class="movie-information">

                <span class="details-label">✦ CINEBOT PRESENTS</span>

                <h1>
                    ${escapeHTML(title)}
                    ${anime.startDate?.year ? `<span>(${escapeHTML(anime.startDate.year)})</span>` : ""}
                </h1>

                ${subtitle ? `<p class="director">${escapeHTML(subtitle)}</p>` : ""}

                <div class="movie-meta">
                    <span>⭐ ${escapeHTML(formatScore(anime.averageScore))}</span>
                    <span>🎭 ${escapeHTML(genres || "Unknown genre")}</span>
                    <span>📺 ${escapeHTML(formatFormat(anime.format))}</span>
                </div>

                <div class="movie-meta">
                    <span>🎞 ${escapeHTML(episodes)} episodes</span>
                    <span>⏱ ${escapeHTML(duration)}</span>
                    ${statusBadgeHTML(anime.status)}
                </div>

                ${nextEpisodeHTML(anime.nextAiringEpisode)}

                <h2>THE STORY</h2>

                <p class="movie-overview">${escapeHTML(story)}</p>

                <a class="trailer-button"
                   href="${escapeHTML(watchURL)}"
                   target="_blank"
                   rel="noopener noreferrer">
                    ▶ WATCH ON HIANIME
                </a>

                ${trailer ? `
                    <a class="trailer-button"
                       href="${escapeHTML(trailer)}"
                       target="_blank"
                       rel="noopener noreferrer">
                        ▶ WATCH TRAILER
                    </a>
                ` : ""}

            </div>

        </section>

        <section class="details-section">
            <h2>✦ INFORMATION</h2>

            <div class="cast-grid">
                <div class="cast-card">
                    <strong>Studio</strong>
                    <span>${escapeHTML(formatList(studios))}</span>
                </div>

                <div class="cast-card">
                    <strong>Season</strong>
                    <span>${escapeHTML(season)}</span>
                </div>

                <div class="cast-card">
                    <strong>Start Date</strong>
                    <span>${escapeHTML(formatStartDate(anime.startDate))}</span>
                </div>

                <div class="cast-card">
                    <strong>Mean Score</strong>
                    <span>${escapeHTML(formatScore(anime.meanScore))}</span>
                </div>
            </div>
        </section>

        <section class="details-section">
            <h2>✦ TAGS</h2>

            <input type="checkbox" id="tagsToggle" class="tags-toggle">

            <div class="tag-list">
                ${(anime.tags || []).length
                    ? anime.tags.map(tag => `<span class="tag-chip">${escapeHTML(tag.name)}</span>`).join("")
                    : `<p>No tags available.</p>`
                }
            </div>

            ${(anime.tags || []).length > 12 ? `
                <label for="tagsToggle" class="tags-more-btn">
                    <span class="tags-show-more">Show more</span>
                    <span class="tags-show-less">Show less</span>
                </label>
            ` : ""}
        </section>
    `;
}

async function loadAnimeDetails() {
    const container = document.getElementById("animeDetails");

    if (!container) return;

    const animeId = container.dataset.animeId;

    if (!animeId || !/^\d+$/.test(animeId)) {
        renderError(container, "This anime link is invalid.");
        return;
    }

    renderLoading(container);

    try {
        const response = await fetch(`/api/anime/details/${animeId}`, {
            headers: { "Accept": "application/json" }
        });

        let data;

        try {
            data = await response.json();
        } catch {
            throw new Error("The server returned an invalid response.");
        }

        if (!response.ok) {
            throw new Error(data?.error || `Could not load anime (${response.status}).`);
        }

        renderAnime(container, data);

    } catch (error) {
        console.error("Anime details error:", error);
        renderError(container, error.message || "Could not load anime details.");
    }
}

window.loadAnimeDetails = loadAnimeDetails;

document.addEventListener("DOMContentLoaded", loadAnimeDetails);