var ACCOUNT_EMAIL = '<ACCOUND_HOLDER_EMAIL_ADDRESS>';
var contentType = "application/json";
var mixpanelJql = "function main(){return join(Events({from_date:\"START_DATE\",to_date:\"END_DATE\"}),People(),{type:\"inner\"}).filter(function(e){if(-1==e.event.name.toLowerCase().indexOf(\"wobot_slack_not_a_valid_candidate\")&&-1!=e.event.name.toLowerCase().indexOf(\"wobot_\")&&-1==e.event.name.toLowerCase().indexOf(\"pro_active\")&&-1==e.user.properties.\$email.toLowerCase().indexOf(\"workboard\"))return e.event&&e.user}).groupBy([\"user.properties.\$email\"],mixpanel.reducer.count()).reduce(mixpanel.reducer.count())}";

/***
* Access token and other related constants
*/
var Constants = {
  MIXPANEL_ENDPOINT : "https://mixpanel.com/api/2.0/jql",
  MIXPANEL_TOKEN : "YOUR_MIXPANEL_API_TOKEN",
  WOBO_ENDPOINT : "https://www.myworkboard.com/wb/apis/metric/{metric_id}",
  WOBO_TOKEN : "WOBO_API_TOKEN",
  WOBO_STREAM_ENDPOINT : "https://www.myworkboard.com/wb/apis/stream/", 
  WOBO_STREAM_KEY : 'WOBO_STREAM_KEY',
  WOBO_STREAM_SIGNATURE : 'WOBO_STREAM_SIGNATURE', 
  MY_DM_SLACK_WEBHOOK_URL: "SLACK_DM_INTERNAL_WEB_HOOK",
  SERVICE_NOW_INSTANCE_ENDPOINT: "https://<YOUR_SERVICE_NOW_INSTANCE>/api/now/table/incident",
  SERVICE_NOW_AUTH_CREDENTIALS: "<SERVICE_NOW_USER_NAME>:<SERVICE_NOW_PASSWORD>"
};

var pipeLine = [];
var data = null;


/**
* Entry function: This function will exectue the pipeline if there are any recipes
*/
function cook(){
  /**
  * Initialize the pipeline to cook mixpanel_to_wobo dish, once this pipeline executes, it connects to Mixpanel, read data for the weekly actives
  * Users and then it update that metric in WorkBoard. 
  */
  initialize('mixpanel_to_wobo');
  start();
  
  /**
  * Initialize the pipeline to cook servicenow_to_wobo_stream dish, once this pipeline executes, it connects to ServiceNow, read data for the priority one
  * incidents and then it update that in a data stream in WorkBoard. 
  */
  initialize('servicenow_to_wobo_stream');
  start();
  
}

/**
* Once the pipeline has a recipe execute, this call will start preparing the dishes
*/
function start(){
  if(this.pipeLine.length > 0){
    var recipes = new Recipes(this);
    for(var i = 0; i < this.pipeLine.length; i++){
      var pipeLineTask = this.pipeLine[i];
      Logger.log("Pipe-line task: ", pipeLineTask); 
      Utilities.sleep(2.5 * 1000);
    
      recipes[pipeLineTask.call]();
      if(typeof pipeLineTask.complete !== 'undefined' && pipeLineTask.complete){
        Logger.log("Completing the stage by calling: "+ pipeLineTask.complete);
        recipes[pipeLineTask.complete]();
      }
    }
  }
}

/**
* Initialize the tasks in the pipeline
*/
function initialize(dish){
  this.pipeLine = [];
  switch(dish){
    case 'mixpanel_to_wobo':
      pipeLine.push({call: "getMixPanelData", complete: "mixPanelToWobo"});
      pipeLine.push({call: "updateResultsInWobo", complete: "woboToAlert"});
      break;
    case 'servicenow_to_wobo_stream':
      pipeLine.push({call: "getServiceNowData", complete: "nowToWoboStream"});
      pipeLine.push({call: "updateDataInWoboDataStream", complete: "slackAlert"});
      break;
  }
}

/**
* Set the input for the pipeline
*/
function setPipeInput(data){
  this.data = data;
}

/*
* Get the output from the pipeline
*/
function getPipeOutput(){
  return this.data;
}

/***
* Time-framing the JQL query
*/
function getJqlString (start, end){
    // replace start date
  mixpanelJql = mixpanelJql.replace("START_DATE", start);
  mixpanelJql = mixpanelJql.replace("END_DATE", end);
  return mixpanelJql;
}

/***
* Get Current and Last 7th day date
*/
function getStartEndDate(){
  // compute date window
   var startDate = new Date();
   var endDate = Utilities.formatDate(startDate, "GMT", "yyyy-MM-dd");
   
   startDate.setTime(startDate.getTime() - (24*60*60*1000) * 7);
   startDate = Utilities.formatDate(startDate, "GMT", "yyyy-MM-dd");
   return [startDate, endDate];
}

/***
 * Doing API Calls
 * method: GET | PUT | POST
 */
function doX(method, url, headers, payload){
    var params ={
        "method" : method
    };
    // Set headers if available
    if(headers){
      params['headers'] = headers;
    }
  
    // Set payload if not empty
    if(payload){
      params['payload'] = payload;
    }
    return UrlFetchApp.fetch(url, params);
}

/***
* Record the update in the spreadsheet
*/
function insertInSpreadSheet(data){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets()[0];
  sheet.appendRow(data);
}

var Recipes = function(_this){
  return {
    /*
    * Get Mixpanel data from the API over JQL [https://mixpanel.com/help/reference/jql/api-reference]
    */
    getMixPanelData : function(){
      var lastRunOutput = _this.getPipeOutput();
      var startEndDate = _this.getStartEndDate();
      var mixpanelJqlString = _this.getJqlString(startEndDate[0], startEndDate[1]);
      Logger.log("JQL: ", mixpanelJqlString);
      
      var headers = {
        "Authorization" : "Basic "+ Utilities.base64Encode(_this.Constants.MIXPANEL_TOKEN + ':'),
        "contentType" : _this.contentType,
      };
      var payload = {script: mixpanelJqlString};
      var response = doX('POST', _this.Constants.MIXPANEL_ENDPOINT, headers, payload);
      if(response){
        Logger.log("Mixpanel API Response:" + response);
        
        // Set the response for next pipeline stage
        _this.setPipeInput(response);  
        
        // store in the sheet
        _this.insertInSpreadSheet(["Response from Mixpanel:", response]);
      }
    },
    getServiceNowData : function(){
      var lastRunOutput = _this.getPipeOutput();

      var headers = {
        "Authorization" : "Basic "+ Utilities.base64Encode(_this.Constants.SERVICE_NOW_AUTH_CREDENTIALS),
        "contentType" : _this.contentType,
      };
      var payload = null;
      var response = doX('GET', _this.Constants.SERVICE_NOW_INSTANCE_ENDPOINT + '?sysparm_query=priority=1', headers, payload);
      if(response){
        Logger.log("ServiceNow API Response:" + response);
        
        // Set the response for next pipeline stage
        _this.setPipeInput(response);  
        
        // store in the sheet
        _this.insertInSpreadSheet(["Response from ServiceNow: ", response]);
        
      }
    },
    
    /***
    * Message translation that converts the output from ServiceNow to the required input for the WorkBoard Stream
    **/
    nowToWoboStream : function(){
      var output = _this.getPipeOutput();
        output = JSON.parse(output);
        if(output && output.result.length > 0){
          Logger.log("nowToWoboStream: response: "+ output);
           var o = + output.result.length;
           _this.setPipeInput(o);
        }
    },
    /***
    * Message translation that converts the output from Mixpanel to the required input for the WorkBoard Key Results 
    */
    mixPanelToWobo : function(){
        var output = _this.getPipeOutput();
        output = JSON.parse(output);
        Logger.log("mixPanelToWobo: 1. response: "+ output);
        if(output && output.length > 0){
          Logger.log("mixPanelToWobo: response: "+ output);
           var o = + output[0];
           _this.setPipeInput(o);
        }
    }, 
    /*
    * Update Results in WorkBoard over REST API calls [https://www.workboard.com/developer/documentation.php]
    */
    updateResultsInWobo : function(){
      var lastRunOutput = _this.getPipeOutput();
      Logger.log("Updating results in WoBo " + lastRunOutput);
      if(lastRunOutput){
        var woboData  = {metric_data : lastRunOutput};
        var woboUrl = _this.Constants.WOBO_ENDPOINT + "?token=" + _this.Constants.WOBO_TOKEN;
        
        var response = doX('PUT', woboUrl, null, woboData);
        
        Logger.log("WoBo API Response:" + response);
        
         _this.setPipeInput(response); 
        
        // Set the response for next pipeline stage
        // store in the sheet
        _this.insertInSpreadSheet(["To WoBo", response]);
      }
    },
    updateDataInWoboDataStream : function(){
       var lastRunOutput = _this.getPipeOutput();
       Logger.log("Updating results in WoBo " + lastRunOutput);
      if(lastRunOutput){
        var woboStreamUrl = _this.Constants.WOBO_STREAM_ENDPOINT;
        var woboStreamUrlForMyStream = woboStreamUrl + _this.Constants.WOBO_STREAM_KEY;
         var headers = {
           "x-stream-signature" : _this.Constants.WOBO_STREAM_SIGNATURE,
           "contentType" : _this.contentType,
         };
        var woboData = {data: JSON.stringify({stream : {connector : {connector_id: 12307, connector_data: {value:lastRunOutput}}}})};
        var response = doX('POST', woboStreamUrlForMyStream, headers, woboData);
        
        Logger.log("WoBo API Response:" + response);
        
        _this.setPipeInput({msg:{text: 'Number of priority-1 incidents received today: ' + lastRunOutput}}); 
        
        // Set the response for next pipeline stage
        // store in the sheet
        _this.insertInSpreadSheet(["To WoBo Stream", response]);
      }
    },
    woboToAlert : function(slackToo) {
      var output = _this.getPipeOutput();
      output = JSON.parse(output);
      if(output.success){
        if(typeof output.data !== 'undefined' && typeof output.data.metric !== 'undefined' && output.data.metric.metric_progress < 100){
          var subject = 'KR: ' + output.data.metric.metric_name + ', needs your attention!';
          var body = 'Link: https://www.myworkboard.com/wb/goal/index'; 
          var msg = {'email': _this.ACCOUNT_EMAIL, subject: subject, body: body};
          this.sendEmail(msg);
          
          if(typeof slackToo !== 'undefined'){
            var slackMsg = {'text': subject};
            this.slackAlert(slackMsg);
          }
        }
      }
    },
    /*
    * Send an email
    */
    sendEmail : function(message){
        MailApp.sendEmail(message.email, message.subject, message.body);
    },
    /***
    * Send a direct message to your named Slack channel for the configured incoming hook url 
    */
    slackAlert: function(msg, attachment){
      var output = _this.getPipeOutput();
      if(typeof output !== 'undefined' && output.msg){
        msg = output.msg;
      }
      if(typeof msg !== 'undefined'){
        var headers = {
           "contentType" : _this.contentType
         };
        var slackMsg = JSON.stringify(msg);
        var response = doX('POST', _this.Constants.MY_DM_SLACK_WEBHOOK_URL, null, slackMsg);
      }
    }
  }
}
