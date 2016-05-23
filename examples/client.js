require('seneca')()
  .use('..')

  .client( {type: 'balance'} )
  .client( {port: 47000} )
  .client( {port: 47001} )

  .ready( function () {
    var me = this;
    for(var i = 0; i < 100; i++) {
        this.act( 'a:1,x:1', console.log )
    }
    
    setTimeout(function(){
        me.act({
            role: 'transport', type: 'balance', get: 'stats'
        }, function(err, result) {
            console.log(result);
        });
    }, 1000);
    
  })

// $ node client.js --seneca.log=type:act
