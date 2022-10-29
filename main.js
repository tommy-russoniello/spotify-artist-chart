const API_URL = 'https://api-partner.spotify.com/pathfinder/v1/query'
const ARTIST_QUERY_SHA = 'e38c23e4e8aa873903ab47c2c84ab9f1175e645cf03a34eafdeea07454e5c3da'
const ALBUM_QUERY_SHA = '3ea563e1d68f486d8df30f69de9dcedae74c77e684b889ba7408c589d30f7f2e'
const SINGLE_QUERY_SHA = 'e02547d028482cec098d8d31899afcf488026d5dbdc2fcb973f05657c9cd6797'

$(document).ready(function () {
  var auth;
  var artist;
  var debug;
  function run () {
    chrome.storage.local.get(['debug'], function(result) {
      debug = result.debug === 'true'
      chrome.storage.local.get(['auth'], function(result) {
        auth = result.auth
        chrome.storage.local.get(['artist'], function(result) {
          artist = result.artist
          getDiscography()
        })
      })
    })
  }

  function displayError (errorMessage = 'An error occurred.') {
    $('#error').html(errorMessage)
    $('#error').show()
  }

  function debugLog(message) {
    if (!debug) return

    console.log(message)
  }

  function makeRequest ({uri, limit, querySha, action, success, error, context}={}) {
    const variables = {
      "uri": uri,
      "offset": 0,
      "limit": limit
    }
    const extensions = {
      "persistedQuery": {
        "version": 1,
        "sha256Hash": querySha
      }
    }
    const url = new URL(API_URL);
    url.searchParams.append("operationName", action)
    url.searchParams.append("variables", JSON.stringify(variables))
    url.searchParams.append("extensions", JSON.stringify(extensions))

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

  function getDiscography () {
    var releases = []
    const promises = [
      makeRequest({
        uri: `spotify:artist:${artist}`,
        limit: 100,
        querySha: ARTIST_QUERY_SHA,
        action: "queryArtistDiscographyAlbums",
        success: function(data) {
          albumsData = data.data.artist.discography.albums.items
          for (i = 0; i < albumsData.length; i++) {
            releases.push(albumsData[i].releases.items[0])
          }
        },
        error: function(data) {
          console.log(data)
          displayError(data.responseText)
        }
      }),
      makeRequest({
        uri: `spotify:artist:${artist}`,
        limit: 100,
        querySha: SINGLE_QUERY_SHA,
        action: "queryArtistDiscographySingles",
        success: function(data) {
          albumsData = data.data.artistUnion.discography.singles.items
          for (i = 0; i < albumsData.length; i++) {
            releases.push(albumsData[i].releases.items[0])
          }
        },
        error: function(data) {
          console.log(data)
          displayError(data.responseText)
        }
      })
    ]
    $.when.apply($, promises).then(function() {
      getTracks(releases)
    });
  }

  function getTracks (discography) {
    var promises = []
    var releases = {}
    for (var i = 0; i < discography.length; i++) {
      promises.push(
        makeRequest({
          uri: `spotify:album:${discography[i].id}`,
          limit: 300,
          querySha: ALBUM_QUERY_SHA,
          action: "queryAlbumTracks",
          context: {
            releaseData: {
              date: Date(discography[i].date.isoString),
              link: discography[i].sharingInfo.shareUrl,
              name: discography[i].name
            }
          },
          success: function(data) {
            releases[this.releaseData.name] = {
              date: this.releaseData.date,
              link: this.releaseData.link,
              tracks: data.data.album.tracks.items
            }
          }
        })
      )
    }
    $.when.apply($, promises).then(function() {
      debugLog(releases)
      var tracks = []
      var playCounts = {}
      for (const release in releases) {
        // Add release date in here from albums[album][date] and make it so the oldest is taken when there's a dupe song
        // use KEY to test since he has a lot of dupes and few songs (screenshot of no dupes on desktop)
        // if it turns out that there are dupe albums with same release date, use shorter name
        // mayybbbe if the plays are the same and the name matches up to a hyphen?
        // also might need to make a special character filter, e.g. "Can’t Complain" vs "Can't Complain" (...and case)
        //
        // maybe make it so you can see a per album view? (like total plays per album)
        releases[release].tracks.forEach((trackData) => {
          const track = trackData.track
          if (playCounts[[track.name, track.playcount]]) return

          playCounts[[track.name, track.playcount]] = true
          tracks.push({
            track: track.name,
            plays: track.playcount,
            releaseLink: releases[release].link,
            releaseName: release,
            id: trackData.uid
          })
        });
      }

      debugLog(tracks)
      displayTracks(tracks)
    }, function(data) {
      console.log(data)
      displayError(data.responseText)
    });
  }

  function displayTracks (tracks) {
    tracks.sort(function(a, b) {
      return b.plays - a.plays;
    });
    for (var i = 0; i < tracks.length; i++) {
      playCountString = tracks[i].plays.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
      $("#table").find("tbody")
        .append($('<tr>')
            .append($('<td>').text(i + 1).addClass("row-number"))
            .append($('<td>').text(tracks[i].track))
            .append($('<td>')
              .append($('<a>')
                .attr("target", "_blank")
                .attr("href", tracks[i].releaseLink)
                .text(tracks[i].releaseName)
              )
            )
            .append($('<td>').text(playCountString).attr('data-sort', tracks[i].plays))
            .append($('<td>').text(tracks[i].id))
        )
    }

    $(".table").show()
  }

  run()
})

document.addEventListener('click', function (e) {
  try {
    function findElementRecursive(element, tag) {
      return element.nodeName === tag ? element : findElementRecursive(element.parentNode, tag)
    }

    const regex_table = /\bsortable\b/
    const element = findElementRecursive(e.target, 'TH')
    const tr = findElementRecursive(element, 'TR')
    const table = findElementRecursive(tr, 'TABLE')

    if (regex_table.test(table.className)) {
      var i = 1
      $(".row-number").each(function () {
        $(this).html(i)
        i++
      })
    }
  } catch (error) {}
})
