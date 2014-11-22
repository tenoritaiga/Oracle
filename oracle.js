#!/usr/bin/env node

var auth = require("./auth");
var util = require('util');
var GroupMe = require('groupme');
var sh = require('execSync');
var API = GroupMe.Stateless;
var _ = require('lodash');
var $ = require('jquery')(require("jsdom").jsdom().parentWindow);
var http = require('http');
var https = require('https');
var request = require('request');
var express = require('express');

var app = express();

const ACCESS_TOKEN = auth.ACCESS_TOKEN;	//GroupMe API key
const USER_ID  = auth.USER_ID;		//GroupMe User ID (numeric)
const BOT_NAME = auth.BOT_NAME;		//Bot name (string)
const BOT_ID = auth.BOT_ID;		//Bot ID (numeric)

var retryCount = 3;
var timeLastMessageReceived = -1;

function getMagicCard(cardname)
{
  var dfd = new $.Deferred();
  var cardimageurl = "";
  request('http://mtgimage.com/card/'+cardname+'.jpg', function(err,resp) {
    if(resp.statusCode === 200)
    {
      cardimageurl = "http://mtgimage.com/card/"+cardname+".jpg";
      cardimageurl = cardimageurl.replace(/ /g,"_");
      dfd.resolve(cardimageurl);
    }
    else
    {
      cardimageurl = "Got no results for that search, sorry.";
      dfd.resolve(cardimageurl);
    }
  });

	return dfd.promise();
}

function centsToDollars(value)
{
  return (value/100).toFixed(2);
}

function getMagicPrices(cardname)
{
  var dfd = new $.Deferred();
  
  var pricestring = "Pricing data for " + cardname + ": \n";
  cardname = cardname.toLowerCase();
  cardname = cardname.replace(/ /g,"-");
  cardname = cardname.replace(/,/g, '');
  
  request('https://api.deckbrew.com/mtg/cards/'+cardname, function(err,resp,body) {
    if(resp.statusCode === 200)
    {
      var json = JSON.parse(body);
      
      for(i in json.editions)
      {
	if(json.editions[i].price)
	{
	  pricestring += json.editions[i].set + ":" + 
	  " [ Low: $" + centsToDollars(json.editions[i].price.low) + 
	  " Median: $" + centsToDollars(json.editions[i].price.median) +
  " High: $" + centsToDollars(json.editions[i].price.high)
+ " ] \n";
	}
	
      }
      if(pricestring.length >= 450)
	pricestring = pricestring.substring(0,400);
      dfd.resolve(pricestring);
    }
    else
    {
      pricestring = "Got no results for that search, sorry.";
      dfd.resolve(pricestring);
    }
  });
  return dfd.promise();
}

function sleep(ms) {
    var start = new Date().getTime(), expire = start + ms;
    while (new Date().getTime() < expire) { }
    return;
}

//SplitArgs function, courtesy of https://github.com/Parent5446/web-bash
$.splitArgs = function( txt ) {
    var cmd = "",
        split_text = [],
        inQuote = false,
        inDoubleQuote = false,
        backslash = false;

    if(txt == undefined) {
        return [];
    }

    for ( var i = 0; i < txt.length; i++ ) {
        if ( txt[i] === ' ' && ( inQuote || inDoubleQuote ) ) {
            cmd += txt[i];
        } else if ( txt[i] === ' ' && !( inQuote || inDoubleQuote ) ) {
            if ( cmd.length > 0 ) {
                split_text.push(cmd);
                cmd = "";
            }
            continue;
        } else if ( txt[i] === '\\' ) {
            if ( backslash || inQuote ) {
                cmd += '\\';
                backslash = false;
            } else {
                backslash = true;
            }
        } else if ( txt[i] === '\'' ) {
            if ( backslash ) {
                cmd += '\'';
                backslash = false;
            } else if ( inDoubleQuote ) {
                cmd += '\'';
            } else {
                inQuote = !inQuote;
            }
        } else if ( txt[i] === '\"' ) {
            if ( backslash ) {
                cmd += '\"';
                backslash = false;
            } else if ( inQuote ) {
                cmd += '\"';
            } else {
                inDoubleQuote = !inDoubleQuote;
            }
        } else if ( txt[i] === '$' && inQuote ) {
            cmd += '\\$';
        } else {
            cmd += txt[i];
            backslash = false;
        }
    }

    cmd = $.trim( cmd );
    if ( cmd !== '' ) {
        split_text.push( cmd );
    }

    return split_text;
};

// IncomingStream constructor

var incoming = new GroupMe.IncomingStream(ACCESS_TOKEN, USER_ID, null);

// Log IncomingStream status to terminal
incoming.on('status', function() {
    var args = Array.prototype.slice.call(arguments);
    var str = args.shift();
    console.log("[IncomingStream 'status']", str, args);
});


function socketWatch()
{
  var currentTime = new Date().getTime();
  if(timeLastMessageReceived != -1 && timeLastMessageReceived <= (currentTime - 45000))
    forceReconnect();
}

//Force reconnect if needed
function forceReconnect()
{
  console.log("Detected delay longer than 45s, reconnecting...");
  timeLastMessageReceived = -1;
  incoming.disconnect();
  sleep(3000);
  incoming.connect();
}

// Wait for messages on IncomingStream

incoming.on('message', function(msg) {
  
  timeLastMessageReceived = new Date().getTime();

  console.log("[IncomingStream 'message'] Message Received at " + timeLastMessageReceived);
    
    if(msg["data"]
        && msg["data"]["subject"]
        && msg["data"]["subject"]["text"]) {
        var message = $.splitArgs(""+msg["data"]["subject"]["text"]);
        if(message[0] == "@help")
        {
            sleep(1000);
            API.Bots.post(ACCESS_TOKEN,BOT_ID,
                "List of current commands:\n" +
                    "@mtg <card> - Display a card image to the group \n",
		    "@price <card> - Get TCGPlayer pricing data for a card \n",
                {},
                function(err,res) {
                    if (err) {
                        console.log("[API.Bots.post] Reply Message Error!");
                    } else {
                        console.log("[API.Bots.post] Reply Message Sent!");
                    }});
        }

        if(message[0] == "@mtg")
        {
            sleep(1000);
            $.when( getMagicCard(message[1]) ).done(
                function( status ) {
                    console.log("getMagicCard returned: "+status);
                    API.Bots.post(
                        ACCESS_TOKEN, // Identify the access token
                        BOT_ID, // Identify the bot that is sending the message
                        status,
                        {}, // No pictures related to this post
                        function(err,res) {
                            if (err) {
                                console.log("[API.Bots.post] Reply Message Error!");
                            } else {
                                console.log("[API.Bots.post] Reply Message Sent!");
                            }});
                });
        }
        
        if(message[0] == "@price")
	{
	  sleep(1000);
	  $.when( getMagicPrices(message[1]) ).done(
	    function( status ) {
	      console.log("getMagicPrices returned: "+status);
	      API.Bots.post(
		ACCESS_TOKEN, // Identify the access token
		BOT_ID, // Identify the bot that is sending the message
		status,
		{}, // No pictures related to this post
		function(err,res) {
		  if (err) {
		    console.log("[API.Bots.post] Reply Message Error!");
		  } else {
		    console.log("[API.Bots.post] Reply Message Sent!");
		  }});
	    });
	}
        
    }

});

//Listen for bot disconnect
incoming.on('disconnected', function() {
    console.log("[IncomingStream 'disconnect']");
    if (retryCount > 3) {
        retryCount = retryCount - 1;
        incoming.connect();
    }
})

//Listen for errors on IncomingStream
incoming.on('error', function() {
    var args = Array.prototype.slice.call(arguments);
    console.log("[IncomingStream 'error']", args);l
    if (retryCount > 3) {
        retryCount = retryCount - 1;
        incoming.connect();
    }
})


//Start connection process
incoming.connect();
socketWatch();
setInterval(socketWatch,30);
