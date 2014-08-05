// TODO:
// package all under namespace
// complete steps
// fix animation - interaction conflicts
// fix all fixme and todo items

// Alert for not supported browsers
if(!document.createElementNS || !document.createElementNS('http://www.w3.org/2000/svg','svg').createSVGRect){
  alert('Sorry, this visualization uses the SVG standard, most modern browsers support SVG. If you would like to see this visualization please view this page in another browser such as Firefox, Safari, Google Chrome or Internet Explorer 9+');
}

// Global object to access variables
var Viz = d3.map();

// Responsive function to redraw on resize
d3.select(window).on("resize", throttle);

var mapWidth = document.getElementById('viz-container').offsetWidth;
var mapHeight = mapWidth / 2;

var zoom = d3.behavior.zoom()
    .scaleExtent([1, 4])
    .on("zoom", move);

Viz.set("tooltip", d3.select("#tooltip"));

/**
  * Map coloring depends on the map's state
  * mapState values are
  * visaSums : number of visa free countries
  * community : community color groups
*/
Viz.set("mapState", "visaSums");

// Add the color based on number of visa free countries
var visaSizeColor = d3.scale.threshold()

/**
  * There are 11 communities found with more than 1 member
  * Communities are already ordered in the data, community indexes go between 0-10
  * Communities with indexes larger than 10 are given the same color - since they are not part of community
*/
var communityColor = d3.scale.threshold()
  .domain(d3.range(12))
  .range(['#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#b2182b', '#fb9a99', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a', '#b15928'])

// initiate the map
setupMap(mapWidth,mapHeight);

function setupMap(width,height) {
  var projection = d3.geo.mercator()
    .translate([(width/2), (height/2)])
    .scale( width / 2 / Math.PI);

  var path = d3.geo.path().projection(projection);

  var svg = d3.select("#map").append("svg")
      .attr("width", width)
      .attr("height", height)
      .call(zoom)
      .append("g");

  // Access map related variables later on
  Viz.set("projection", projection);
  Viz.set("mapPath", path);
  Viz.set("mapSvg", svg);
}

// Load the data async
queue()
  .defer(d3.json, "data/world-topo-min.json")
  .defer(d3.json, "data/country_visas_refined.json")
  .defer(d3.tsv, "data/country_visa_communities.tsv")
  .defer(d3.text, "data/filter_countries.txt")
  .await(ready);

function ready(error, world, visas, countryCommunities, filterCountries) {
  var countryData = topojson.feature(world, world.objects.countries).features;

  var visaIDs = visas["countriesList"];

  // Countries with no Geo path data
  // filter those out from the typeahead
  var noGeoCountries = d3.csv.parseRows(filterCountries).reduce(function(a, b) { return a.concat(b); }, []);
  var countrySelection = visaIDs.filter(function(c) { return noGeoCountries.indexOf(c) < 0; });

  var communities = d3.map();
  countryCommunities.forEach(function(v) {
    if(noGeoCountries.indexOf(v.country_list) < 0)
      communities.set(v.country_list, v.community);
  });

  // Add visa information
  countryData.forEach(function(d) {
    var cn = d.properties.name;
    var visaID = visaIDs.indexOf(cn);
    // Check if there is visa info for this country
    // Add visa and community data
    if (visaID >= 0) {
      d.visaID = visaID;
      d.visas = visas[cn];
      d.visaSums = d3.sum(d.visas);
      d.community = +communities.get(cn);
    } else {
      // visaID = -1 for countries with no visa data
      d.visaID = visaID;
    }
  });

  // TODO: delete if redundant
  // Viz.set("visas", visas);
  Viz.set("visaIDs", visaIDs);
  Viz.set("countryData", countryData);

  // Calculate number of visa percentiles - to color the map per number of visa free countries
  var visaSums = countryData.filter(function(d) { return d.visaID >= 0; })
                              .map(function(d) { return d.visaSums; });


  // visaSizeColor is based on the percentiles of visa-free country totals
  Viz.set("visaSizePercentiles", [0.05, 0.25, 0.5, 0.75, 0.95]);
  Viz.set("visaSizePercentileValues", calculatePercentiles(visaSums, [0.05, 0.25, 0.5, 0.75, 0.95]));

  visaSizeColor
    .domain(Viz.get("visaSizePercentileValues"))
    .range(['#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32']);

  drawMap(countryData);
  drawVisaPercLegend();

  // Create the typeahead for comparison
  $('.typeahead')
    .typeahead({
      hint: true,
      highlight: true,
      minLength: 1
    },
    {
      name: 'countries',
      displayKey: 'value',
      source: substringMatcher(countrySelection)
    })
    .on("typeahead:selected", texboxPickCountry)
    .on("typeahead:autocompleted", texboxPickCountry)
    .on("click", stopAnimation);

  // Add button to clear typeahead selection
  d3.select("span.clear-selector")
    .on("click", function() {
      stopAnimation();
      resetTypeahead();
    });

  // Toggle map view upon button clicks
  d3.selectAll("#buttons button")
    .on("click", function() {
      stopAnimation();
      toggleMapView(this);
    });

  // Setup annotation steps
  d3.selectAll("li.step-link").on("click", function() {
    var clickedStep = d3.select(this).attr("id");
    selectStep(clickedStep);
  });

  d3.selectAll("#annotation-nav-buttons arrow").on("click", function() {
    var currentStep = d3.select("li.step-link.active").attr("id");
    // TODO: add step switcher via arrow clicks
  })
}

function drawMap(countryData) {
  var svg = Viz.get("mapSvg");
  var path = Viz.get("mapPath");
  g = svg.append("g").attr("class", "mapG");

  var country = g.selectAll(".country").data(countryData);

  country.enter().insert("path")
      // Add visaID and visaSums to the class for easier selection later
      .attr("class", function(d) {
        var visaSumClass = d.visaID >= 0 ? visaSizeColor(d.visaSums).replace("#", "") : "0"
        return "country c" + d.visaID + " s"+ visaSumClass;
      })
      .attr("d", path)
      .attr("id", function(d,i) { return d.id; })
      .attr("title", function(d,i) { return d.properties.name; });

  // Default color mode
  if (Viz.get("mapState") === "visaSums") {
    paintVisaSums();
  } else {
    paintCommunities();
  }

  country
    .on("mousemove", function(d,i) {
      Viz.get("tooltip").classed("hidden", false)
          .attr("style", "left:"+(d3.event.pageX + 10)+"px;top:"+(d3.event.pageY + 15)+"px")
          //.html(d.properties.name);
          .html([
            '<p class="title">'+ d.properties.name + '</p>',
            '<p class="subtitle">'+ (Viz.get("mapState") === "visaSums" ? d.visaSums + " visa-free countries" : "") + '</p>'
          ].join(''));
    })
    .on("mouseout",  function(d,i) {
      Viz.get("tooltip").classed("hidden", true);
    })
    .on("click", function(d, i) {
      stopAnimation();
      // Update typeahead
      $('.typeahead').typeahead('val', d.properties.name);

      // Check if there is a selection already or if the user selects the already selected country
      if (d3.select("#map .country.selected").empty() || !Viz.has("previousCountry") || Viz.get("previousCountry") !== d) {
        selectCountry(d);
        drawResetTypeahead();
      } else {
        // Upon 2nd click on the selected country, deselect the current selection
        resetTypeahead();
      }
    });
}


function redraw() {
  mapWidth = document.getElementById('viz-container').offsetWidth;
  mapHeight = mapWidth / 2;
  // console.log(mapWidth, mapHeight);
  d3.select('#map svg').remove();
  setupMap(mapWidth,mapHeight);
  drawMap(Viz.get("countryData"));

  // If there is a text on typeahead, redraw the reset X as well
  if (d3.select("span.clear-selector").classed("selected"))
    drawResetTypeahead();
}

// Zoom functions
function move() {
  var width = mapWidth;
  var height = mapHeight;

  var t = d3.event.translate;
  var s = d3.event.scale;
  zscale = s;
  var h = height/4;

  t[0] = Math.min(
    (width/height)  * (s - 1),
    Math.max( width * (1 - s), t[0] )
  );

  t[1] = Math.min(
    h * (s - 1) + h * s,
    Math.max(height  * (1 - s) - h * s, t[1])
  );

  zoom.translate(t);
  d3.select("#map svg g.mapG").attr("transform", "translate(" + t + ")scale(" + s + ")");

  // TODO: Adjust the country hover stroke width based on zoom level
  // d3.selectAll(".country").style("stroke-width", 1.5 / s);
}

// Helper function to zoom into the country given the name
function zoomToCountryName(countryName) {
  var country = Viz.get("countryData").filter(function(c) { return c.properties.name === countryName});

  if(country.length)
    zoomToCountry(country[0]);
}

// Zoom the map into the given country
function zoomToCountry(country) {
  // Calculate bounding box of the country features
  var path = Viz.get("mapPath"),
        width = mapWidth,
        height = mapHeight,
        bounds = path.bounds(country.geometry),
        dx = bounds[1][0] - bounds[0][0],
        dy = bounds[1][1] - bounds[0][1],
        x = (bounds[0][0] + bounds[1][0]) / 2,
        y = (bounds[0][1] + bounds[1][1]) / 2,
        scale = Math.min(.9 / Math.max(dx / width, dy / height), 4),
        translate = [width / 2 - scale * x, height / 2 - scale * y];

  // Set the new zoom values and position the map
  zoom.translate(translate).scale(scale);
  d3.select("#map svg g.mapG").transition()
      .duration(750)
      .attr("transform", "translate(" + translate + ")scale(" + scale + ")");
}

// Get the zoom to default view
function resetZoom() {
  var translate = [0, 0],
        scale = 1;

  zoom.translate(translate).scale(scale);
  d3.select("#map svg g.mapG").transition()
      .duration(1500)
      .attr("transform", "translate(" + translate + ")scale(" + scale + ")");
}

// Redraw based on the window resize
var throttleTimer;
function throttle() {
  window.clearTimeout(throttleTimer);
    throttleTimer = window.setTimeout(function() {
      redraw();
    }, 200);
}

// Change the map coloring type
function toggleMapView(_this){
  var overallSelected = d3.select(_this).classed("overall");
  // Detect which button is clicked
  if (overallSelected) {
    Viz.set("mapState", "visaSums");
    paintVisaSums();
  } else {
    Viz.set("mapState", "community");
    paintCommunities();
    hideSelectionLegend();
  }

  // Keep the selected country
  if (Viz.has("previousCountry")) {
    selectCountry(Viz.get("previousCountry"));
  }

  // Update CSS
  d3.select("button.overall").classed("active", overallSelected);
  d3.select("button.community").classed("active", !overallSelected);
  d3.select("#communitiesLegend").classed("visible", !overallSelected);
}

// Update country colors based on visa requirement
function selectCountry(selectedCountry){
  // Don't do anything if no visa data available
  // FIXME: how to display this to the user?
  if (selectedCountry.visaID == -1) {
    return;
  }

  var country = d3.selectAll("#map .country");

  // Deselect the previous selection
  d3.selectAll("#map .country.selected")
    .classed("selected", false);

  // Paint based on the map mode
  if (Viz.get("mapState") === "visaSums") {
    country
      .transition().duration(500)
      // Get the opacity back to original
      .style("opacity", 1)
      .style("fill", function(d) {
        return (d.visaID < 0 || selectedCountry.visas[d.visaID] === 0) ? "#ccc" : "#1f77b4";
      });

      // Paint the selected country
      d3.select(".country.c" + selectedCountry.visaID)
        .transition().duration(500)
        .style("fill", "#ff7f0e");

      // Show the selection legend
      showSelectionLegend();
  } else {
    // Community colors

    // Return the previous selected country to original color
    if (Viz.has("previousCountry")) {
      d3.select(".country.c" + Viz.get("previousCountry").visaID)
        .transition().duration(500)
        .style("opacity", 1)
        .style("fill", fillCommunityColor);
    }

    // Lower the opacity of non visa-free countries - to highlight the visa-free countries
    country
      .transition().duration(500)
      .style("opacity", function(d) {
        if (this.style.color !== "rgb(204, 204, 204)" && selectedCountry.visas[d.visaID] === 0
            && +this.id !== selectedCountry.id) {
          return 0.3;
        }
      });

    // Paint selected country
    d3.select(".country.c" + selectedCountry.visaID)
      .transition().duration(500)
      .style("fill", function(d) {
        if (this.style.fill && this.style.fill !== "rgb(204, 204, 204)") {
          return d3.rgb(this.style.fill).darker(0.3);
        }
      });
  }

  // References to the selected country
  d3.select(".country.c" + selectedCountry.visaID)
    .classed("selected", true);

  Viz.set("previousCountry", selectedCountry);
}

function texboxPickCountry(event, selection) {
  // TODO: check if the selected country exists
  var selectedCountry = Viz.get("countryData").filter(function(d){ return d.properties.name == selection.value; })[0];
  selectCountry(selectedCountry);
  drawResetTypeahead();
}

var fillVisaSumsColor =  function(d, i) {
  // Check if visa information available
  return d.visaID >= 0 ? visaSizeColor(d.visaSums) : "#DBDBDB";
}

// Paint the countries based on the number of visa free countries each has
// Default color mode
function paintVisaSums() {
  var country = Viz.get("mapSvg").selectAll("g.mapG path.country");

  country
      //.transition().duration(500)
      .style("opacity", 1)
      .style("fill", fillVisaSumsColor)

  // Display the visa sums percentiles legend
  d3.select("#visaPercLegend").classed("hidden", false);
}

var fillCommunityColor =  function(d, i) {
  // Check if visa information available
  return d.visaID >= 0 ? communityColor(d.community) : "#DBDBDB";
}

// Paint the countries based on the community they belong to
function paintCommunities() {
  var country = Viz.get("mapSvg").selectAll("g.mapG path.country");

  country
      //.transition().duration(0)
      .style("opacity", 1)
      .style("fill", fillCommunityColor)

  // Hide the visa sums percentiles legend
  d3.select("#visaPercLegend").classed("hidden", true);
}

// Draw the visa sums percentiles legend
function drawVisaPercLegend() {
  var svg = d3.select("#visaPercLegend").append("svg");

  var g = svg.append("g")
    .attr("class", "visaSumsKey")
    // space for the legend caption
    .attr("transform", "translate(0,16)");

  var percentiles = Viz.get("visaSizePercentiles");

  // A position encoding for the legend
  var x = d3.scale.linear()
      //.domain(d3.extent(Viz.get("visaSizePercentiles")))
      .domain([0, 1])
      .range([0, 240]);

  var xAxis = d3.svg.axis()
    .scale(x)
    .orient("bottom")
    .tickSize(13)
    .tickValues(percentiles)
    .tickFormat(d3.format("%"));

  g.selectAll("rect")
    .data(visaSizeColor.range().map(function(d, i) {
      return {
        x0: i ? x(percentiles[i - 1]) : x.range()[0],
        x1: i < percentiles.length ? x(percentiles[i]) : x.range()[1],
        z: d
      };
    }))
    .enter().append("rect")
      .attr("height", 8)
      .attr("x", function(d) { return d.x0; })
      .attr("width", function(d) { return d.x1 - d.x0; })
      .style("fill", function(d) { return d.z; })
      .on("mousemove", function(d,i) {
        // FIXME : what to say on the tooltip
        var percValues = Viz.get("visaSizePercentileValues");
        var tooltipVal = i ? (i < percentiles.length ? "Between " + d3.round(percValues[i-1]) + " and " + d3.round(percValues[i])
            : "More than " + d3.round(percValues[percentiles.length-1]))
          : ("Less than " + d3.round(percValues[i]));

        Viz.get("tooltip").classed("hidden", false)
          .attr("style", "left:"+(d3.event.pageX + 5)+"px;top:"+(d3.event.pageY - 28)+"px")
          .html(tooltipVal + " visa-free countries");

        /**
          * Highlight countries with the mouseover color = based on percentile
          * this is achieved via setting the opacity of other countries lower
        */
        d3.selectAll(".country").style("opacity", 0.3);
        var selectedCountry = Viz.has("previousCountry") ? Viz.get("previousCountry") : undefined;
        d3.selectAll(".country.s" + d.z.replace("#", ""))
          .style("opacity", function(d) {
            if (this.style.color !== "rgb(204, 204, 204)" &&
              (!selectedCountry || (selectedCountry.visas[d.visaID] === 0 && +this.id !== selectedCountry.id))) {
                return 1.0;
            }
          });
      })
      .on("mouseout",  function(d,i) {
        Viz.get("tooltip").classed("hidden", true);

        // Set the opacities back to default
        d3.selectAll(".country")
          .style("opacity", 1);
      });

  g.call(xAxis).append("text")
    .attr("class", "caption")
    .attr("y", -6)
    .text("Number of Visa Free Countries");
}

// Display the visa sums selection color legend
function showSelectionLegend() {
  d3.select("#visaSums-selection-legend").classed("selected", true);

  // Paint typeahead to indicate selectio
  d3.select(".typeahead.tt-input")
    // first paint to white, else transition starts from black - due to initial transparent
    .style("background-color", "white")
    .transition().duration(750)
    .style("background-color", "#ff7f0e");
}

// Hide the visa sums selection color legend
function hideSelectionLegend() {
  d3.select("#visaSums-selection-legend").classed("selected", false);

  // Paint typeahead transparent to indicate deselection
  d3.select(".typeahead.tt-input")
    .style("background-color", "transparent");
}

// Reset typeahead selection
function resetTypeahead() {
  d3.select("span.clear-selector")
      .classed("selected", false);

  $('.typeahead').typeahead('val', '');

  // Deselect the previous selection
  d3.selectAll(".country.selected")
      .classed("selected", false);

  Viz.remove("previousCountry");

  hideSelectionLegend();

  // Reset map colors based on the view
  // Default color mode
  if (Viz.get("mapState") === "visaSums") {
    paintVisaSums();
  } else {
    paintCommunities();
  }

}

// Draw X icon to reset typeahead selection
function drawResetTypeahead() {
  // Find the position of the typeahead
  var coords = d3.select("span.twitter-typeahead")[0][0].getBoundingClientRect();
  d3.select("span.clear-selector")
      .classed("selected", true)
      // Pay attention to scroll positions
      .attr("style", "left:" + (coords.left + coords.width - 10 + $(window).scrollLeft()) + "px; top:" + (coords.top + coords.height/6 + $(window).scrollTop()) + "px");
}

// On user interaction, stop ongoing animations
function stopAnimation() {
  if (Viz.has("timer")) {
    clearTimeout(Viz.get("timer"));
    Viz.remove("timer");
  }
}

// Stepper functions
function selectStep(step) {
  // Interrupt any ongoing animation to focus the reader on the selected step
  stopAnimation();

  // In case map zoom is changed - back to default
  resetZoom();

  switchStep(step);
  switchAnnotation(step);
}

function switchStep(newStep) {
  d3.selectAll(".step-link").classed("active", false);
  d3.select("#" + newStep).classed("active", true);
}

function switchAnnotation(newStep) {
  steps[newStep]();

  d3.selectAll(".annotation-step")
    .style("display", "none")
    .style("opacity", 0.0);

  d3.select("#annotation-" + newStep)
    .style("display", "block")
    .transition().delay(100).duration(300)
      .style("opacity", 1);
}

// Initial view with countries colored by visa sums
function drawVisaSumsDefault() {
  Viz.set("mapState", "visaSums");
  paintVisaSums();

  // De-select country selection
  resetTypeahead();

  // Update CSS
  d3.select("button.overall").classed("active", true);
  d3.select("button.community").classed("active", false);
  d3.select("#communitiesLegend").classed("visible", false);
}


// Annotation steps defined
var steps = {}
steps.step1 = function() {
  // Initial view
  drawVisaSumsDefault();
};

/**
  * To workaround D3's transition limitation of "Only one transition may be active on a given element at a given time"
  * .. country colors are set to default state initiall without transition
  * .. then new color change is applied with transition
  * (else the colors become off due to the cancelation of transition in paintVisaSums function)
*/
steps.step2 = function() {
  // In case player interacted and interfered the presentation
  drawVisaSumsDefault();

  /**
    * Highlight EU countries and NZ - highest amount of visa-free
    * first find those highest amount of visa-free countries by the color
    * then lower the opacities of all countries but these
  */
  var c = visaSizeColor.range()[visaSizeColor.range().length -1];
  d3.selectAll(".country")
    .style("opacity", 1)
    .transition().duration(1000)
    .style("opacity", 0.3)
    .style("fill", fillVisaSumsColor);

  d3.selectAll(".country.s" + c.replace("#", ""))
    .transition().duration(1000)
    .style("opacity", function(d) {
      return 1.0;
    })
    .style("fill", fillVisaSumsColor);
};

steps.step3 = function() {
  // In case player interacted and interfered the presentation
  drawVisaSumsDefault();

  var EUcountries = ['Germany', 'Italy', 'United Kingdom', 'Spain', 'Sweden'];

  (function selectionAnimationLoop (i) {
    if (!i || Viz.has("timer")) {
      Viz.set("timer", setTimeout(function() {
        if (i <= EUcountries.length * 2 - 1) {
          var c = EUcountries[i % EUcountries.length];
          $('.typeahead').val(c).trigger('typeahead:selected', {"value": c});
          i++;
          selectionAnimationLoop(i);
        } else {
          Viz.remove("timer");
        }
      }, 1000));
    }
  })(0);

  //$('.typeahead').val("Turkey").trigger('typeahead:selected', {"value": "Turkey"});
}

steps.step4 = function() {
  var delay = 1500;

  // Clear any ongoing animation
  stopAnimation();

  // In case player interacted and interfered the presentation
  drawVisaSumsDefault();

  setTimeout(function() {
    zoomToCountryName("Afghanistan");
  }, delay);
  setTimeout(function() {
    $('.typeahead').val("Afghanistan").trigger('typeahead:selected', {"value": "Afghanistan"});
  }, delay*2);
  setTimeout(function() {
    resetZoom();
  }, delay*3);
}

steps.step5;

// Helper functions

// Match user input in typeahead box
function substringMatcher(strs) {
  return function findMatches(q, cb) {
    var matches, substringRegex;

    // an array that will be populated with substring matches
    matches = [];

    // regex used to determine if a string contains the substring `q`
    substrRegex = new RegExp(q, 'i');

    // iterate through the pool of strings and for any string that
    // contains the substring `q`, add it to the `matches` array
    $.each(strs, function(i, str) {
      if (substrRegex.test(str)) {
        // the typeahead jQuery plugin expects suggestions to a
        // JavaScript object, refer to typeahead docs for more info
        matches.push({ value: str });
      }
    });

    cb(matches);
  };
}

// Return percentiles for the given number array vals
function calculatePercentiles(vals, percs) {
  var values = vals.sort(d3.ascending);
  var res = [];
  var percentiles = percs ? percs : [0.25, 0.5, 0.75, 0.9];

  percentiles.forEach(function(p) {
    res.push(d3.quantile(values, p));
  });

  return res;
}