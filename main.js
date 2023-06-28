const API_URL = 'https://api-partner.spotify.com/pathfinder/v1/query'
const ARTIST_QUERY_SHA = 'e38c23e4e8aa873903ab47c2c84ab9f1175e645cf03a34eafdeea07454e5c3da'
const ALBUM_QUERY_SHA = '3ea563e1d68f486d8df30f69de9dcedae74c77e684b889ba7408c589d30f7f2e'
const SINGLE_QUERY_SHA = 'e02547d028482cec098d8d31899afcf488026d5dbdc2fcb973f05657c9cd6797'
const REMASTER_TEXT = '((re-?)?master(ed)?|mix|mono|stereo|deluxe?|UK|US)(\\ (single\\ )?(version|edition|deluxe?))?'
const SPECIAL_EDITION_TEXT = '(((\\d{1,3}(st|nd|rd|th)[\\w\\ ]*)|([\\w\\ ]*(super|deluxe?|special|UK|US)[\\w\\ ]*))(edition|version|deluxe?))'
const REMASTER_REGEX = new RegExp(`\\ ?[-|\\(|\\/|;]\\ ?(${SPECIAL_EDITION_TEXT}\\ ?[-|\\/|;]?\\ ?)?((\\d{4}\\ ?${REMASTER_TEXT})|(${REMASTER_TEXT}\\ ?\\d{4})|${REMASTER_TEXT}|${SPECIAL_EDITION_TEXT})(\\ ?\\/\\ ${REMASTER_TEXT})?\\)?$`, 'i')

$(document).ready(function () {
  var auth
  var artistId
  var debug
  function run () {
    chrome.storage.local.get([
      'debug',
      'auth',
      'artistId',
      'artistName'
    ], function (result) {
      debug = result.debug === 'true'
      auth = result.auth
      artistId = result.artistId
      $(document).prop('title', `${result.artistName} | Spotify Artist Play Count`)
      getDiscography()
    })
  }

  // ----------------------------------------------------------------------------
  //                             Helpers
  // ----------------------------------------------------------------------------

  function assignTrackFields (track, trackData, name, release) {
    Object.assign(track, {
      release: release,
      remove: track.removed || false,
      name: name,
      raw_name: trackData.track.name,
      plays: trackData.track.playcount,
      duration: trackData.track.duration.totalMilliseconds,
      id: trackData.uid
    })
  }

  // Fixes formatting and removes and metadata from the end of the
  // given album/track name. E.g.,
  // 1. "Street Fighting Man - 50th Anniversary Edition / Remastered 2018" =>
  // "Street Fighting Man"
  // 2. "Enter Sandman (Remastered)" => "Enter Sandman"
  // 3. "(I Can't Get No) Satisfaction - Mono Version" =>
  // "(I Can't Get No) Satisfaction"
  function CleanUpName (name) {
    return name.trim().normalize().replace('’', "'").replace(REMASTER_REGEX, '')
  }

  function debugLog (message) {
    if (!debug) return

    console.log(message)
  }

  function displayError (errorMessage = 'An error occurred.') {
    $('#error').html(errorMessage)
    $('#error').show()
  }

  function getFirstWordOfString (string) {
    return string.match(/^[^.,/#!$%^&*;:{}=`~()\s]*/)?.at(0)?.toLowerCase()
  }

  function makeRequest ({ uri, limit, querySha, action, success, error, context } = {}) {
    const variables = {
      uri: uri,
      offset: 0,
      limit: limit
    }
    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: querySha
      }
    }
    const url = new URL(API_URL)
    url.searchParams.append('operationName', action)
    url.searchParams.append('variables', JSON.stringify(variables))
    url.searchParams.append('extensions', JSON.stringify(extensions))

    return $.ajax({
      url: url,
      type: 'GET',
      dataType: 'json',
      headers: {
        authorization: `Bearer ${auth}`
      },
      success: success,
      error: error,
      context: context
    })
  }

  function recordRemovedTrackForDebug (tracks, track) {
    if (!debug) return

    const removedTrack = Object.assign({}, track)
    removedTrack.removed = true
    tracks.push(removedTrack)
  }

  // Replace track if any of the following is true:
  // 1. The existing track is a single and the new one isn't.
  // 2. The existing track was released before the new one.
  // 3. The tracks have the same release date, but the existing one has a longer
  // name (meaning it is likely some redone version).
  function shouldReplaceTrack (existingTrack, newTrack) {
    if (existingTrack.release.single && !newTrack.release.single) return true
    if (existingTrack.release.date > newTrack.release.date) return true
    if (existingTrack.release.date !== newTrack.release.date) return false
    return existingTrack.raw_name.length >= newTrack.raw_name.length
  }

  // Track data shows the track is by only the current artist.
  function trackDataMatchesArtist (trackData) {
    return trackData.track.artists.items.length === 1 &&
      trackData.track.artists.items[0].uri.split(':')[2] === artistId
  }

  // Tracks have similar durations if they're within 10 seconds of eachother.
  function tracksHaveSimilarDurations (trackA, trackB) {
    return Math.abs(trackA.duration - trackB.duration) < 10000
  }

  // Tracks have similar names if they start with the same word.
  function tracksHaveSimilarNames (trackA, trackB) {
    const firstWord = getFirstWordOfString(trackA.name)
    return firstWord && firstWord === getFirstWordOfString(trackB.name)
  }

  // Tracks have similar plays if they have measurable plays (tracks with <1,000
  // plays show as having 0) and the difference between the more played one and
  // less played one is less than 0.1% of the more played one's plays.
  function tracksHaveSimilarPlays (trackA, trackB) {
    return trackA.plays > 0 && Math.abs(trackA.plays - trackB.plays) <
      Math.max(trackA.plays, trackB.plays) * 0.001
  }

  // ----------------------------------------------------------------------------

  function getDiscography () {
    var releases = []
    const promises = [
      makeRequest({
        uri: `spotify:artist:${artistId}`,
        limit: 100,
        querySha: ARTIST_QUERY_SHA,
        action: 'queryArtistDiscographyAlbums',
        success: function (data) {
          const albumsData = data.data.artist.discography.albums.items
          albumsData.forEach(albumData => {
            releases.push(albumData.releases.items[0])
          })
        },
        error: function (data) {
          console.log(data)
          displayError(data.responseText)
        }
      }),
      makeRequest({
        uri: `spotify:artist:${artistId}`,
        limit: 100,
        querySha: SINGLE_QUERY_SHA,
        action: 'queryArtistDiscographySingles',
        success: function (data) {
          const albumsData = data.data.artistUnion.discography.singles.items
          albumsData.forEach(albumData => {
            releases.push(Object.assign(albumData.releases.items[0], { single: true }))
          })
        },
        error: function (data) {
          console.log(data)
          displayError(data.responseText)
        }
      })
    ]
    $.when.apply($, promises).then(function () {
      getTracks(releases)
    })
  }

  function getTracks (discography) {
    debugLog(REMASTER_REGEX)

    var promises = []
    var releases = []
    for (var i = 0; i < discography.length; i++) {
      promises.push(
        makeRequest({
          uri: `spotify:album:${discography[i].id}`,
          limit: 300,
          querySha: ALBUM_QUERY_SHA,
          action: 'queryAlbumTracks',
          context: {
            releaseData: {
              date: new Date(discography[i].date.isoString),
              link: discography[i].sharingInfo.shareUrl,
              name: CleanUpName(discography[i].name),
              single: discography[i].single
            }
          },
          success: function (data) {
            releases.push({
              name: this.releaseData.name,
              date: this.releaseData.date,
              link: this.releaseData.link,
              single: this.releaseData.single,
              tracks: data.data.album.tracks.items
            })
          }
        })
      )
    }
    $.when.apply($, promises).then(function () {
      debugLog(releases)
      var tracks = []
      var tracksByPlayCount = {}
      var tracksByName = {}
      releases.forEach(release => {
        // maybe make it so you can see a per album view?
        // (like total plays per album)
        release.tracks.forEach(trackData => {
          if (!trackDataMatchesArtist(trackData)) return

          const newTrack = {}
          const trackName = CleanUpName(trackData.track.name)
          assignTrackFields(newTrack, trackData, trackName, release)

          // If this track is a duplicate of one that's already been added,
          // only keep the better one.
          let existingTrack = tracksByPlayCount[newTrack.plays]
          if (existingTrack &&
            (tracksHaveSimilarNames(existingTrack, newTrack) &&
            tracksHaveSimilarDurations(existingTrack, newTrack))) {
            if (shouldReplaceTrack(existingTrack, newTrack)) {
              recordRemovedTrackForDebug(tracks, existingTrack)
              assignTrackFields(existingTrack, trackData, newTrack.name, newTrack.release)
            } else {
              recordRemovedTrackForDebug(tracks, newTrack)
            }

            return
          }

          existingTrack = tracksByName[newTrack.name]
          if (existingTrack && tracksHaveSimilarPlays(existingTrack, newTrack)) {
            if (shouldReplaceTrack(existingTrack, newTrack)) {
              recordRemovedTrackForDebug(tracks, existingTrack)
              assignTrackFields(existingTrack, trackData, newTrack.name, newTrack.release)
            } else {
              recordRemovedTrackForDebug(tracks, newTrack)
            }

            return
          }

          tracksByName[newTrack.name] = newTrack
          tracksByPlayCount[newTrack.plays] = newTrack
          tracks.push(newTrack)
        })
      })

      debugLog(tracks)
      displayTracks(tracks)
    }, function (data) {
      console.log(data)
      displayError(data.responseText)
    })
  }

  function displayTracks (tracks) {
    tracks.sort(function (a, b) {
      return b.plays - a.plays
    })
    let removedCount = 0
    for (var i = 0; i < tracks.length; i++) {
      const track = tracks[i]
      if (track.removed) removedCount += 1
      // Format number with commas
      const playCountString = track.plays.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      $('#table').find('tbody')
        .append($('<tr>').addClass(track.removed ? 'removed' : '')
          .append($('<td>').text(track.removed ? 'X' : i + 1 - removedCount).addClass('row-number'))
          .append($('<td>').text(track.name))
          .append($('<td>')
            .append($('<a>')
              .attr('target', '_blank')
              .attr('href', track.release.link)
              .text(track.release.name)
            )
          )
          .append($('<td>').text(playCountString).attr('data-sort', track.plays))
          .append($('<td>').text(track.id))
        )
    }

    $('.table').show()
  }

  run()
})

document.addEventListener('click', function (e) {
  try {
    function findElementRecursive (element, tag) {
      return element.nodeName === tag ? element : findElementRecursive(element.parentNode, tag)
    }

    const regexTable = /\bsortable\b/
    const element = findElementRecursive(e.target, 'TH')
    const tr = findElementRecursive(element, 'TR')
    const table = findElementRecursive(tr, 'TABLE')

    if (regexTable.test(table.className)) {
      var i = 1
      $('.row-number').each(function () {
        $(this).html(i)
        i++
      })
    }
  } catch (error) {}
})
