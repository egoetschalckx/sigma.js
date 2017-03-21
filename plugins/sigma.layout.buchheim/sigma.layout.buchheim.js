/*global sigma console*/
(function (undefined) {
  'use strict'

  if (typeof sigma === 'undefined') {
    throw new Error('sigma is not declared')
  }

  // Initialize package:
  sigma.utils.pkg('sigma.layout.buchheim')

  /**
   * Buchheim Layout
   * ===============================
   *
   * Author: @egoetschalckx / Eric Goetschalckx
   * Algorithm: Buchheim et al
   * Acknowledgement: @apitts / Andrew Pitts (sigma.js plugin scaffolding)
   * Version: 0.1
   */
  var _instance = {}
  var _eventEmitter = {}

  var settings = {
    rendererIndex: 0
  }

  /**
   * Buchheim Tree Layout Object
   * ------------------
   */
  function Buchheim() {
    var self = this

    this.init = function (sigInst, options) {
      options = options || {}

      this.sigInst = sigInst
      this.config = sigma.utils.extend(options, settings)

      if (options.nodes) {
        this.nodes = options.nodes
        delete options.nodes
      }

      if (!sigma.plugins || typeof sigma.plugins.animate === 'undefined') {
        throw new Error('sigma.plugins.animate is not declared')
      }

      // State
      this.running = false
    }

    /**
     * Calculate layout
     */
    this.go = function () {
      if (!this.running) {
        return false
      }

      var nodes = this.nodes || this.sigInst.graph.nodes()
      var edges = this.edges || this.sigInst.graph.edges()
      initNodeDefaults(nodes)
      initHeirarchy(nodes, edges)

      // todo: get id of root node
      var r = nodes[0]

      firstWalk(r)
      secondWalk(r, -1 * r.prelim)

      //this.calcNodeBounds()
      //this.setSigmaPositions()

      this.running = false
      this.stop()
    }

    this.start = function () {
      if (this.running) {
        return
      }

      var nodes = this.sigInst.graph.nodes()

      var prefix = this.sigInst.renderers[self.config.rendererIndex].options.prefix

      this.running = true

      // Init nodes
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].dn_x = nodes[i][prefix + 'x']
        nodes[i].dn_y = nodes[i][prefix + 'y']
        nodes[i].dn_size = nodes[i][prefix + 'size']
        nodes[i].dn = {
          dx: 0,
          dy: 0
        }
      }

      _eventEmitter[self.sigInst.id].dispatchEvent('start')

      this.go()
    }

    this.stop = function () {
      var nodes = this.sigInst.graph.nodes()

      this.running = false

      if (this.easing) {
        _eventEmitter[self.sigInst.id].dispatchEvent('interpolate')
        sigma.plugins.animate(
          self.sigInst,
          {
            x: 'dn_x',
            y: 'dn_y'
          },
          {
            easing: self.easing,
            onComplete: function () {
              self.sigInst.refresh()
              for (var i = 0; i < nodes.length; i++) {
                nodes[i].dn = null
                nodes[i].dn_x = null
                nodes[i].dn_y = null
              }
              _eventEmitter[self.sigInst.id].dispatchEvent('stop')
            },
            duration: self.duration
          }
        )
      } else {
        // Apply changes
        for (var i = 0; i < nodes.length; i++) {
          nodes[i].x = nodes[i].buchheim_x
          nodes[i].y = nodes[i].buchheim_y
        }

        this.sigInst.refresh()

        for (var j = 0; j < nodes.length; j++) {
          nodes[j].dn = null
          nodes[j].dn_x = null
          nodes[j].dn_y = null
        }

        _eventEmitter[self.sigInst.id].dispatchEvent('stop')
      }
    }

    this.kill = function () {
      this.sigInst = null
      this.config = null
      this.easing = null
    }
  }

  function isLeaf(v) {
    return v.children.length <= 0
  }

  function leftmostChild(v) {
    return v.children[0]
  }

  function rightmostChild(v) {
    return v.children[v.children.length - 1]
  }

  function leftmostSibling(v) {
    if (v.parent === null) {
      return null;
    }

    return v.parent.children[0];
  }

  function leftSibling(v) {
    if (v.parent === null) {
      return null;
    }

    var sibling = null
    for (var i = 0; i < v.parent.children.length; i++) {
      var child = v.parent.children[i]
      if (v.id === child.id) {
        var siblingIndex = i - 1
        if (siblingIndex >= 0) {
          sibling = v.parent.children[siblingIndex]
          break;
        }
      }
    }

    return sibling
  }

  function initHeirarchy(nodes, edges) {
    var nodeMap = {}

    // graph had better be acyclic and directed...
    for (var i = 0; i < edges.length; i++) {
      var edge = edges[i]
      var parent = getNodeById(nodeMap, nodes, edge.source)
      var child = getNodeById(nodeMap, nodes, edge.target)

      parent.children.push(child)
      child.number = parent.children.length - 1
      child.parent = parent
      child.depth = parent.depth + 1
    }
  }

  function initNodeDefaults(nodes) {
    var nodesCount = nodes.length
      for (var i = 0; i < nodesCount; i++) {
        nodes[i].mod = 0
        //nodes[i].thread = 0
        nodes[i].thread = null
        nodes[i].ancestor = nodes[i]
        nodes[i].children = []
        nodes[i].parent = null

        // ??
        nodes[i].depth = 0
        nodes[i].change = 0
        nodes[i].shift = 0
      }
  }

  function getNodeById(nodeMap, nodes, id) {
    if (nodeMap.hasOwnProperty(id)) {
      return nodeMap[id]
    }

    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) {
        nodeMap[id] = nodes[i]
        return nodes[i]
      }
    }
  }

  /**
   * Traverses the left contour of a subtree. Returns the successor of v on this contour.
   * This successor is either given by the leftmost child of v or by the thread of v
   * The function returns 0 if and only if v is on the highest level of its subtree
   */
  function nextLeft(v) {
    if (v.children.length > 0) {
      return leftmostChild(v)
    }

    return v.thread
  }

  function nextRight(v) {
    if (v.children.length > 0) {
      return rightmostChild(v)
    }

    return v.thread
  }

  /**
   * moveSubtree(w-, w+, shift)
   * Let subtrees be the number of children of the current root between w and w+ plus 1
   *
   * let subtrees = number(w+) - number(w-)
   * let change(w+) = change(w+) - shift / subtrees
   * let shift(w+) = shift(w+) + shift
   * let change(w-) = change(w-) + shift / subtrees
   * let prelim(w+) = prelim(w+) + shift
   * let mod(w+) = mod(w+) + shift
   */
  function moveSubtree(wMinus, wPlus, shift) {
    console.log("moveSubtree " + wMinus.id + ", " + wPlus.id + ", " + shift)

    // hack: where does node.number get init?
    var subtrees = wPlus.number - wMinus.number

    wPlus.change = wPlus.change - shift / subtrees
    wPlus.shift = wPlus.shift + shift
    wMinus.change = wMinus.change + shift / subtrees
    wPlus.prelim = wPlus.prelim + shift
    wPlus.mod = wPlus.mod + shift
  }

  /**
   * ancestor(vi-, v, defaultAncestor)
   *
   * if anceestors(vi-) is a sibling of v
   *   return ancestor(v)
   * else
   *   return defaultAncestor
   */
  function ancestor(viMinus, v, defaultAncestor) {
    var parent = viMinus.ancestor
    var isSibling = false
    for (var i = 0; i < parent.children.length; i++) {
      if (v.id === parent.children[i].id) {
        isSibling = true;
        break;
      }
    }

    if (isSibling) {
      return v.ancestor
    }

    return defaultAncestor
  }

  /**
   * apportion(v, defaultAncestor)
   *
   * if v has a left sibling w
   *   let vi+ = vo+ = v
   *   let vi- = w
   *   let vo- = leftmost sibling of vi+
   *   let si+ = mod(vi+)
   *   let so+ = mod(vo+)
   *   let si- = mod(vi-)
   *   let so- = mod(vo-)
   *
   * while nextRight(vi-) !== 0 && nextLeft(vi+) !== 0
   *   let vi- = nextRight(vi-)
   *   let vi+ = nextLeft(vi+)
   *   let vo- = nextLeft(vo-)
   *   let vo+ = nextRight(vo+)
   *   let ancestor(vo+) = v
   *   let shift = (prelim(vi-) + si-) - (prelim(vi+) + si+) + distance
   *   if shift > 0
   *     moveSubtree(Ancestor(vi-, v, defaultAncestor), v, shift)
   *     let si+ = si+ + shift
   *     let so+ = so+ + shift
   *   let si- = si- + mod(vi-)
   *   let si+ = si+ + mod(vi+)
   *   let so- = so- + mod(vo-)
   *   let so+ = so+ + mod(vo+)
   * if nextRight(vi-) !== 0 && nextRight(vo+) === 0
   *   let thread(vo+) = nextRight(vi-)
   *   let mod(vo+) = mod(vo+) + si- - so+
   * if nextLeft(vi+) !== 0 and nextLeft(vo-) === 0
   *   let thread(vo-) = nextLeft(vi+)
   *   let mod(vo-) = mod(vo-) + si+ - so-
   *   let defaultAncestor = v
   */
  function apportion(v, defaultAncestor) {
    var distance = 1
    console.log("apportion " + v.id + ", " + defaultAncestor.id)

    var w = leftSibling(v)

    if (w !== null) {
      var viPlus = v
      var voPlus = v
      var viMinus = w
      var voMinus = leftmostSibling(viPlus)

      var siPlus = viPlus.mod
      var soPlus = voPlus.mod
      var siMinus = viMinus.mod
      var soMinus = voMinus.mod

      while (nextRight(viMinus) !== null && nextLeft(viPlus) !== null) {
        viMinus = nextRight(viMinus)
        viPlus = nextLeft(viPlus)
        voMinus = nextLeft(voMinus)
        voPlus = nextRight(voPlus)

        voPlus.ancestor = v

        var shift = (viMinus.prelim + siMinus) - (viPlus.prelim + siPlus) + distance

        if (shift > 0) {
          moveSubtree(ancestor(viMinus, v, defaultAncestor), v, shift)
          siPlus = siPlus + shift
          soPlus = soPlus + shift
        }

        siMinus = siMinus + viMinus.mod
        siPlus = siPlus + viPlus.mod
        soMinus = soMinus + voMinus.mod
        soPlus = soPlus + voPlus.mod
      }

      if (nextRight(viMinus) !== null && nextRight(voPlus) === null) {
        voPlus.thread = nextRight(viMinus)
        voPlus.mod = voPlus.mod + siMinus - soPlus
      }

      if (nextLeft(viPlus) !== null && nextLeft(voMinus) === null) {
        voPlus.thread = nextLeft(viPlus)
        voMinus.mod = voMinus.mod + siPlus - soMinus
        defaultAncestor = v
      }
    }

    return defaultAncestor
  }

  /**
   * executeShifts(v)
   *
   * let shift = 0
   * let change = 0
   * foreach child w of v (from right to left)
   *   let prelim(w) = prelim(w) + shift
   *   let mod(w) = mod(w) + shift
   *   let change = change + change(w)
   *   let shift = shift + shift(w) + change
   */
  function executeShifts(v) {
    var shift = 0
    var change = 0

    console.log("executeShifts " + v.id)

    for (var i = v.children.length - 1; i >= 0; i--) {
      var w = v.children[i]
      w.prelim = w.prelim + shift
      w.mod = w.mod + shift

      // hack: where does node.change get init? (answer - moveSubtree())
      change = change + w.change

      // hack: where does node.shift get init (answer - moveSubtree())
      shift = shift + w.shift + change
    }
  }

  /**
   * Calling FirstWalk(v) computes a preliminary x-coordinate for v
   * firstWalk(v)
   *
   * if v is a is a leaf
   *   let prelim(v) = 0
   * else
   *   let defaultAncestor be the leftmost child of value
   *   for all children w of v (from left to right)
   *     firstWalk(w)
   *     apportion(w, defaultAncestor)
   *   executeShifts(v)
   *   let midpoint = (1/2) * (prelim(leftmost child v) + prelim(rightmost child v))
   *   if v has left sibling
   *     let prelim(v) = prelim(w) + distance
   *     let mod(v) = prelim(v) - midpoint
   *   else
   *     let prelim(v) = midpoint
   */
  function firstWalk(v) {
    var distance = 1
    console.log("firstWalk " + v.id)

    if (isLeaf(v)) {
      //console.log("leaf " + v.id)
      var prevSibling = leftSibling(v);
      if (prevSibling !== null) {
        v.prelim = prevSibling.prelim + 1;
      } else {
        v.prelim = 0
      }
    } else {
      var defaultAncestor = leftmostChild(v)

      // recursively call firstWalk() and apportion() on children of v
      for (var i = 0; i < v.children.length; i++) {
        var child = v.children[i]
        firstWalk(child)
        defaultAncestor = apportion(child, defaultAncestor)
      }

      // space out the children
      executeShifts(v)

      // after spacing out the children v is placed on the midpoint of its outermost children
      var midpoint = .5 * (leftmostChild(v).prelim + rightmostChild(v).prelim)

      var w = leftSibling(v)
      if (w !== null) {
        v.prelim = w.prelim + distance
        v.mod = v.prelim - midpoint
      } else {
        v.prelim = midpoint
      }
    }
  }

  /**
   * Comput real x-coordinates by summing the modifiers recursively
   * secondWalk(v, m)
   *
   * let x(v) = prelim(v) + m
   * let y(v) = level of v
   * foreach child w of v
   *   secondWalk(w, m + mod(v))
   */
  function secondWalk(v, m) {
    console.log("secondWalk " + v.id + ", " + m)

    v.buchheim_x = v.prelim + m
    v.buchheim_y = v.depth

    for (var i = 0; i < v.children.length; i++) {
      var w = v.children[i]
      secondWalk(w, m + v.mod)
    }
  }

  /**
   * Interface
   * ----------
   */

  /**
   * Configure the layout algorithm.
   *
   * Recognized options:
   * **********************
   * Here is the exhaustive list of every accepted parameter in the settings
   * object:
   *
   *   {?integer}           rendererIndex       The index of the renderer to use for node co-ordinates. Defaults to zero.
   *   {?(function|string)} easing              Either the name of an easing in the sigma.utils.easings package or a function. If not specified, the
   *                                            quadraticInOut easing from this package will be used instead.
   *   {?number}            duration            The duration of the animation. If not specified, the "animationsTime" setting value of the sigma instance will be used instead.
   *
   *
   * @param  {object} config  The optional configuration object.
   *
   * @return {sigma.classes.dispatcher} Returns an event emitter.
   */
  sigma.prototype.configBuchheim = function (config) {

    var sigInst = this

    if (!config) {
      throw new Error('Missing argument: "config"')
    }

    // Create instance if undefined
    if (!_instance[sigInst.id]) {
      _instance[sigInst.id] = new Buchheim()

      _eventEmitter[sigInst.id] = {}

      sigma.classes.dispatcher.extend(_eventEmitter[sigInst.id])

      // Binding on kill to clear the references
      sigInst.bind('kill', function () {
        _instance[sigInst.id].kill()

        _instance[sigInst.id] = null

        _eventEmitter[sigInst.id] = null
      })
    }

    _instance[sigInst.id].init(sigInst, config)

    return _eventEmitter[sigInst.id]
  }

  /**
   * Start the layout algorithm. It will use the existing configuration if no
   * new configuration is passed.
   *
   * Recognized options:
   * **********************
   * Here is the exhaustive list of every accepted parameter in the settings
   * object
   *
   *   {?integer}           rendererIndex       The index of the renderer to use for node co-ordinates. Defaults to zero.
   *   {?(function|string)} easing              Either the name of an easing in the sigma.utils.easings package or a function. If not specified, the
   *                                            quadraticInOut easing from this package will be used instead.
   *   {?number}            duration            The duration of the animation. If not specified, the "animationsTime" setting value of the sigma instance will be used instead.
   *
   *
   *
   * @param  {object} config  The optional configuration object.
   *
   * @return {sigma.classes.dispatcher} Returns an event emitter.
   */
  sigma.prototype.startBuchheim = function (config) {

    var sigInst = this

    if (config) {
      this.configBuchheim(sigInst, config)
    }

    _instance[sigInst.id].start()

    return _eventEmitter[sigInst.id]
  }

  /**
   * Returns true if the layout has started and is not completed.
   *
   * @return {boolean}
   */
  sigma.prototype.isBuchheimRunning = function () {

    var sigInst = this

    return !!_instance[sigInst.id] && _instance[sigInst.id].running
  }

}).call(this)
