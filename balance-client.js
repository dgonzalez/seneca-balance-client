/*
  MIT License,
  Copyright (c) 2015-2016, Richard Rodger and other contributors.
*/

// TODO David: handle duplicates in the add (merge conflict)
// TODO David: better approach for observe (possibly a new model... yes!)

'use strict'

var _ = require('lodash')
var Eraro = require('eraro')
var Jsonic = require('jsonic')

var visigoth = require('visigoth');

var error = Eraro({
  package: 'seneca',
  msgmap: {
    'no-target': 'No targets have been registered for message <%=msg%>',
    'no-current-target': 'No targets are currently active for message <%=msg%>'
  }
})


module.exports = balance_client

var global_target_map = {}

var option_defaults = {
  debug: {
    client_updates: false
  }
}

var global_options = {}

balance_client.preload = function () {
  var seneca = this

  seneca.options({
    transport: {
      balance: {
        makehandle: function (config) {
          var instance_map =
                (global_target_map[seneca.id] =
                 global_target_map[seneca.id] || {id: seneca.id})

          var target_map =
                (instance_map[config.pg] =
                 instance_map[config.pg] || {pg: config.pg, id: Math.random()})

          target_map.pg = config.pg

          return function ( pat, action ) {
            add_target( seneca, target_map, config, pat, action )
          }
        }
      }
    }
  })
}

function balance_client (options) {
  var seneca = this
  var tu = seneca.export('transport/utils')
  var modelMap = {
    observe: observeModel,
    consume: consumeModel,

    // legacy
    publish: observeModel,
    actor: consumeModel
  }

  options = seneca.util.deepextend(option_defaults, options)

  // hack to make add_target debug logging work
  // to be fixed when seneca plugin handling is rewritten to not need preload
  global_options = seneca.util.deepextend(global_options, options)

  var model = options.model

  if (null == model) {
    model = modelMap.consume
  }
  else if (typeof model === 'string') {
    model = modelMap[model]
  }

  if (typeof model !== 'function') {
    throw new Error('model must be a string or function')
  }

  seneca.add({
    role: 'transport', hook: 'client', type: 'balance'
  }, hook_client)

  seneca.add({
    role: 'transport', type: 'balance', add: 'client'
  }, add_client)

  seneca.add({
    role: 'transport', type: 'balance', remove: 'client'
  }, remove_client)

  seneca.add({
    role: 'transport', type: 'balance', get: 'target-map'
  }, get_client_map)
  
  seneca.add({
      role: 'transport', type: 'balance', get: 'stats'
  }, get_stats)

  function get_stats(msg, done) {
      msg.config = msg.config || {}

      if ( !msg.config.pg ) {
        msg.config.pg = this.util.pincanon( msg.config.pin || msg.config.pins )
      }
      var instance_map = global_target_map[seneca.id] || {}
      var target_map = instance_map[msg.config.pg] || {}
      // TODO David: something funny goes on here.
      var visigoth = target_map[''];
      var stats = [];
      if (visigoth.upstreams$.lengh <= 0) {
          return done(null, stats);
      }
      
      for (var i = 0; i < visigoth.upstreams$.length; i++) {
          var upstream = visigoth.upstreams$[i];
          var upstream_stats = {};
          upstream_stats.status = upstream.meta$.status;
          upstream_stats.target = upstream.target.id;
          upstream_stats.stats = upstream.meta$.stats;
          stats.push(upstream_stats)
      }
      done(null, stats);
  }

  function remove_target ( target_map, pat, config ) {
    var action_id = config.id || seneca.util.pattern(config)
    var patkey = make_patkey( seneca, pat )
    var targetstate = target_map[patkey]
    var found = false

    targetstate = targetstate || visigoth();
    target_map[patkey] = targetstate
    
    targetstate.remove_by(function(target) {
        if (!found) {
            found = action_id == target.id;
        } else {
            return action_id == target.id;
        }
        return found;
    });

    if (options.debug && options.debug.client_updates) {
      seneca.log.info('remove', patkey, action_id, found)
    }
  }
  
  function add_client (msg, done) {
    msg.config = msg.config || {}

    if ( !msg.config.pg ) {
      msg.config.pg = this.util.pincanon( msg.config.pin || msg.config.pins )
    }

    this.client( msg.config )
    done()
  }


  function remove_client (msg, done) {
    var seneca = this

    msg.config = msg.config || {}

    if ( !msg.config.pg ) {
      msg.config.pg = this.util.pincanon( msg.config.pin || msg.config.pins )
    }

    var instance_map = global_target_map[seneca.id] || {}
    var target_map = instance_map[msg.config.pg] || {}

    var pins = msg.config.pin ? [msg.config.pin] : msg.config.pins

    _.each( pins, function (pin) {
      remove_target( target_map, pin, msg.config )
    })

    done()
  }


  function get_client_map (msg, done) {
    var seneca = this
    var instance_map = global_target_map[seneca.id] || {}
    done(null, null == msg.pg ? instance_map : instance_map[msg.pg])
  }


  function hook_client (msg, clientdone) {
    var seneca = this

    var type = msg.type
    var client_options = seneca.util.clean(_.extend({}, options[type], msg))

    var pg = this.util.pincanon( client_options.pin || client_options.pins )

    var instance_map = global_target_map[seneca.id] || {}
    var target_map = instance_map[pg] || {}

    var model = client_options.model || consumeModel
    model = _.isFunction(model) ? model : ( modelMap[model] || consumeModel )

    tu.make_client(make_send, client_options, clientdone)

    function make_send (spec, topic, send_done) {
      seneca.log.debug('client', 'send', topic + '_res', client_options, seneca)

      send_done(null, function (msg, done) {
        var patkey = msg.meta$.pattern
        var targetstate = target_map[patkey]

        if ( targetstate ) {
          model(this, msg, targetstate, done)
          return
        }

        else return done( error('no-target', {msg: msg}) )
      })
    }

    seneca.add('role:seneca,cmd:close', function (close_msg, done) {
      var closer = this
      closer.prior(close_msg, done)
    })
  }


  function observeModel (seneca, msg, targetstate, done) {
    if ( 0 === targetstate.targets.length ) {
      return done(error('no-current-target', {msg: msg}))
    }
    
    var first = true;
    targetstate.choose_all(function(target) {
        target.action.call(seneca, msg, function() {
            if ( first ) {
              done.apply(seneca, arguments)
              first = false
            }
        });
    });
  }


  function consumeModel (seneca, msg, targetstate, done) {

    targetstate.choose(function(error, target,errored, stats) {
        if (error) {
            return done( error('no-current-target', {msg: msg}) );
        }
        var before = Date.now();
        target.action.call(seneca, msg, function(err, result) {
            done(err, result);
            var after = Date.now();
            stats.totalResponseTime = (stats.totalResponseTime || 0) + (after - before);
            stats.numberOfCalls = (stats.numberOfCalls || 0) + 1;
            stats.averageResponseTime = stats.totalResponseTime / stats.numberOfCalls;
        });
    });
  }
}

function add_target ( seneca, target_map, config, pat, action ) {
  var patkey = make_patkey( seneca, pat )
  var targetstate = target_map[patkey]
  var add = true

  targetstate = targetstate || visigoth();
  target_map[patkey] = targetstate

  // TODO David: handle duplicates...
  if (add) {
    targetstate.add({ action: action,
                               id: action.id,
                               config: config
                             })
  }

  if (global_options.debug && global_options.debug.client_updates) {
    seneca.log.info('add', patkey, action.id, add)
  }
}

function make_patkey ( seneca, pat ) {
  if ( _.isString( pat ) ) {
    pat = Jsonic(pat)
  }

  var keys = _.keys(seneca.util.clean(pat)).sort()
  var cleanpat = {}

  _.each( keys, function (k) {
    cleanpat[k] = pat[k]
  })

  var patkey = seneca.util.pattern( cleanpat )
  return patkey
}
