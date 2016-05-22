require('seneca')()

  .listen( {port: function () { return process.argv[2] }} )

  .add('a:1', function (msg, done) {
    done( null , {result: "works!"})
  })

// run twice:
// $ node server.js 47000 --seneca.log=type:act
// $ node server.js 47001 --seneca.log=type:act

