require('seneca')()
  .use('..')

  .client( {type: 'balance'} )
  .client( {port: 47000} )
  .client( {port: 47001} )

  .ready( function () {

    this.act( 'a:1,x:1', console.log )

  })

// $ node client.js --seneca.log=type:act
