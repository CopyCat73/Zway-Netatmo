/*** Netatmo Z-Way module *******************************************

Version: 1.00
(c) CopyCatz, 2015
-----------------------------------------------------------------------------
Author: CopyCatz <copycat73@outlook.com>
Description: Netatmo weather station data

******************************************************************************/

function Netatmo (id, controller) {
    // Call superconstructor first (AutomationModule)
    Netatmo.super_.call(this, id, controller);
    
    this.client_id          = undefined;
    this.client_secret      = undefined;
    this.username           = undefined;
    this.password           = undefined;
    this.scope              = undefined;
    this.grant_type         = undefined;
    this.access_token       = undefined;
    this.refresh_token      = undefined;
    this.tokentimer         = undefined;
    this.datatimer          = undefined;
    this.numberOfDevices    = undefined;
    this.temperatureUnit    = undefined;
    this.devices            = {};
    this.deviceIndex        = {};
}

inherits(Netatmo, AutomationModule);

_module = Netatmo;

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

Netatmo.prototype.init = function (config) {
    Netatmo.super_.prototype.init.call(this, config);

    var self = this;
    
    this.client_id          = config.client_id.toString();
    this.client_secret      = config.client_secret.toString();
    this.username           = config.username.toString();
    this.password           = config.password.toString();
    this.langFile           = self.controller.loadModuleLang("Netatmo");

    var intervalTime    = parseInt(self.config.interval) * 60 * 1000;
    
    self.datatimer = setInterval(function() {
        self.fetchStationData();
    }, intervalTime);
    
    self.fetchToken();
   
};

Netatmo.prototype.stop = function () {
    var self = this;
    
    if (self.datatimer) {
        clearInterval(self.datatimer);
        self.datatimer = undefined;
    }
    
    if (self.tokentimer) {
        clearInterval(self.tokentimer);
        self.tokentimer = undefined;
    }
    
    self.removeDevices();
    
    Netatmo.super_.prototype.stop.call(this);
};


// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

Netatmo.prototype.addDevice = function(prefix,defaults) {


    var self = this;
    
    var probeTitle  = defaults.probeTitle || '';
    var scaleTitle  = defaults.scaleTitle || '';
    var probeType   = defaults.probeType || prefix;
    delete defaults.probeType;
    delete defaults.probeTitle;
    delete defaults.scaleTitle;
    
    var deviceParams = {
        overlay: { 
            deviceType: "sensorMultilevel",
            probeType: probeType,
            metrics: { 
                probeTitle: probeTitle,
                scaleTitle: scaleTitle
            }
        },
        defaults: {
            metrics: defaults
        },
        deviceId: "Netatmo_"+prefix+"_" + this.id,
        moduleId: prefix+"_"+this.id,
    };

    self.devices[prefix] = self.controller.devices.create(deviceParams);
    return self.devices[prefix];
    
};      
     
Netatmo.prototype.removeDevices = function() {

    var self = this;
    
    if (typeof self.devices !== 'undefined') {
        _.each(self.devices,function(value, key) {
            self.controller.devices.remove(value.id);
        });
        self.devices = {};
    }
};      
        
Netatmo.prototype.fetchToken = function () {
    
    var self = this;

    http.request({
        url: "https://api.netatmo.net/oauth2/token",
        method: "POST",
        headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: {
            grant_type: 'password',
            client_id: self.client_id,
            client_secret: self.client_secret,
            username: self.username,
            password: self.password,
            scope: 'read_station'
        },
        async: true,
        success: function(response) {
            self.access_token = response.data.access_token;
            self.refresh_token = response.data.refresh_token;
            if(self.tokentimer){
                clearTimeout(self.tokentimer);
            }
            self.tokentimer = setInterval(function() {
                self.fetchRefreshToken();
            }, (response.data.expires_in-100) * 1000);
            self.fetchStationData();
        },
        error: function(response) {
            console.error("[Netatmo] Initial token fetch error");
            console.logJS(response);
            self.controller.addNotification(
                "error", 
                self.langFile.err_fetch_token, 
                "module", 
                "Netatmo"
            );
        }
    });
};

Netatmo.prototype.fetchRefreshToken = function () {
    
    var self = this;
    
    if (self.refresh_token != undefined) {
        http.request({
            url: "https://api.netatmo.net/oauth2/token",
            method: "POST",
            headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: {
                grant_type: 'refresh_token',
                client_id: self.client_id,
                client_secret: self.client_secret,
                refresh_token: self.refresh_token
            },
            async: true,
            success: function(response) {
                self.access_token = response.data.access_token;
                self.refresh_token = response.data.refresh_token;
            },
            error: function(response) {
                console.error("[Netatmo] Refresh token fetch error");
                console.logJS(response);
                self.controller.addNotification(
                    "error", 
                    self.langFile.err_fetch_refreshtoken, 
                    "module", 
                    "Netatmo"
                );
                // retry over with new base token
                self.fetchToken();
            }
        });
    }
    else {
        console.error("[Netatmo] Missing refresh token");
        self.refresh_token = undefined;
        // start over with new base token
        self.fetchToken();
    }
};       

    
Netatmo.prototype.fetchStationData = function () {
    
    var self = this;
    //console.logJS('fetch using token '+self.access_token);

    var url = "https://api.netatmo.com/api/getstationsdata?access_token="+this.access_token;
    
    http.request({
        url: url,
        async: true,
        success: function(response) { self.processResponse(response) },
        error: function(response) {
            console.error("[Netatmo] Station data fetch error");
            console.logJS(response);
            self.controller.addNotification(
                "error", 
                self.langFile.err_fetch_data, 
                "module", 
                "Netatmo"
            );
            if (response.data.error.code==3) {
                self.fetchToken();
            }
        }
    });
};

Netatmo.prototype.processResponse = function(response) {
    
    
    var self = this;
    
    var incomingNumberOfDevices = response.data.body.devices.length;
      
    if (self.numberOfDevices == undefined||self.numberOfDevices!=incomingNumberOfDevices) {
        self.initializeDevices(response);
    }
    
    console.log("[Netatmo] Update");
    var currentDate = new Date();
    
    for (dc = 0; dc < self.numberOfDevices; dc++) {
        
        // base stations
        var deviceID = response.data.body.devices[dc]._id;
        var temperature = response.data.body.devices[dc].dashboard_data.Temperature; 
        var humidity = response.data.body.devices[dc].dashboard_data.Humidity;
        var co2 = response.data.body.devices[dc].dashboard_data.CO2; 
        var noise = response.data.body.devices[dc].dashboard_data.Noise; 
        var pressure = response.data.body.devices[dc].dashboard_data.Pressure; 

        if(typeof self.devices['temperature_' + dc] !== "undefined"){
            self.devices['temperature_' + dc].set('metrics:level',temperature);
            self.devices['temperature_' + dc].set('metrics:timestamp',currentDate.getTime());
            self.devices['humidity_' + dc].set('metrics:level', humidity);
            self.devices['humidity_' + dc].set('metrics:timestamp',currentDate.getTime());
            self.devices['co2_' + dc].set('metrics:level', co2);
            self.devices['co2_' + dc].set('metrics:timestamp',currentDate.getTime());
            self.devices['noise_' + dc].set('metrics:level', noise);
            self.devices['noise_' + dc].set('metrics:timestamp',currentDate.getTime());
            self.devices['pressure_' + dc].set('metrics:level', pressure);
            self.devices['pressure_' + dc].set('metrics:timestamp',currentDate.getTime());
        }
        else {
            console.log("[Netatmo] Update device mismatch");
        }
        
        // modules
        var numberOfModules = response.data.body.devices[dc].modules.length;
        for (mc = 0; mc < numberOfModules; mc++) {
            
            var moduleID = response.data.body.devices[dc].modules[mc]._id;
            var numberOfModuleVariables = response.data.body.devices[dc].modules[mc].data_type.length;
            for (mvc = 0; mvc < numberOfModuleVariables; mvc++) {
                
                var variable=response.data.body.devices[dc].modules[mc].data_type[mvc];
                
                if (variable=='Rain') {

                    var icon = '/ZAutomation/api/v1/load/modulemedia/Netatmo/rain.png';

                    var value = response.data.body.devices[dc].modules[mc].dashboard_data[variable];
                    self.devices[variable + '_' + dc + '_' + mc].set('metrics:level', value);
                    self.devices[variable + '_' + dc + '_' + mc].set('metrics:icon', icon);
                    self.devices[variable + '_' + dc + '_' + mc].set('metrics:timestamp',currentDate.getTime());
 
                    value = response.data.body.devices[dc].modules[mc].dashboard_data['sum_rain_1'];
                    self.devices[variable + '1_' + dc + '_' + mc].set('metrics:level', value);
                    self.devices[variable + '1_' + dc + '_' + mc].set('metrics:icon', icon);
                    self.devices[variable + '1_' + dc + '_' + mc].set('metrics:timestamp',currentDate.getTime());
 
                    value = response.data.body.devices[dc].modules[mc].dashboard_data['sum_rain_24'];
                    self.devices[variable + '24_' + dc + '_' + mc].set('metrics:level', value);
                    self.devices[variable + '24_' + dc + '_' + mc].set('metrics:icon', icon);
                    self.devices[variable + '24_' + dc + '_' + mc].set('metrics:timestamp',currentDate.getTime());
 
                
                }
                else {
                    
                    var value = response.data.body.devices[dc].modules[mc].dashboard_data[variable];
                    self.devices[variable + '_' + dc + '_' + mc].set('metrics:level', value);
                    var icon = '/ZAutomation/api/v1/load/modulemedia/Netatmo/'+variable.toLowerCase()+'.png';
                    self.devices[variable + '_' + dc + '_' + mc].set('metrics:icon', icon);
                    self.devices[variable + '_' + dc + '_' + mc].set('metrics:timestamp',currentDate.getTime());
 
                
                }
            }
        }
    }
};

Netatmo.prototype.initializeDevices = function(response) {
    
    console.log("[Netatmo] Init devices");

    var self = this;
 
    self.numberOfDevices = response.data.body.devices.length;
    
    switch (response.data.body.user.administrative.unit) {
    case 0:
        this.temperatureUnit='°C';
        break;
    case 1:
        this.temperatureUnit = '°F';
        break;
    }
    
    for (dc = 0; dc < self.numberOfDevices; dc++) {
        var deviceName = response.data.body.devices[dc].module_name;
        var deviceID = response.data.body.devices[dc]._id;
       
        self.addDevice('temperature_'+dc,{
            probeType: 'temperature',
            scaleTitle: this.temperatureUnit,
            icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/temperature.png',
            title: deviceName + ' ' + self.langFile.temperature
        });
    
        self.addDevice('humidity_'+dc,{
            probeType: 'humidity',
            scaleTitle: '%',
            icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/humidity.png',
            title: deviceName + ' ' + self.langFile.humidity
        });

        self.addDevice('co2_'+dc,{
            probeType: 'co2',
            scaleTitle: 'ppm',
            icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/co2.png',
            title: deviceName + ' ' + self.langFile.co2
         });

        self.addDevice('pressure_'+dc,{
            probeType: 'pressure',
            scaleTitle: 'mbar',
            icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/pressure.png',
            title: deviceName + ' ' + self.langFile.pressure
        });

        self.addDevice('noise_'+dc,{
            probeType: 'noise',
            scaleTitle: 'db',
            icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/noise.png',
            title: deviceName + ' ' + self.langFile.noise
       });
           
        var numberOfModules = response.data.body.devices[dc].modules.length;
        
        for (mc = 0; mc < numberOfModules; mc++) {
            var moduleName = response.data.body.devices[dc].modules[mc].module_name;
            var moduleID = response.data.body.devices[dc].modules[mc]._id;
            var numberOfModuleVariables = response.data.body.devices[dc].modules[mc].data_type.length;
            for (mvc = 0; mvc < numberOfModuleVariables; mvc++) {
                var variable=response.data.body.devices[dc].modules[mc].data_type[mvc];
                var unit = self.getUnit(variable);
                if (variable == 'Rain') {
                    self.addDevice(variable + '_' + dc + '_' + mc,{
                        probeType: 'rain',
                        scaleTitle: unit,
                        title: moduleName + ' ' + variable + ' ('+self.langFile.current+')'
                                    
                    });
                    self.addDevice(variable + '1_' + dc + '_' + mc,{
                        probeType: 'rain',
                        scaleTitle: unit,
                        title: moduleName + ' ' + variable + ' ('+self.langFile.last1+')'
                    });
                    self.addDevice(variable + '24_' + dc + '_' + mc,{
                        probeType: 'rain',
                        scaleTitle: unit,
                        title: moduleName + ' ' + variable + ' ('+self.langFile.last24+')'
                    });
                }
                else {
                    self.addDevice(variable + '_' + dc + '_' + mc,{
                        probeType: variable,
                        scaleTitle: unit,
                        title: moduleName + ' ' + variable
                    });
                }
            }
        }       
    }
};


Netatmo.prototype.getUnit = function(string) {
    
    var self = this;
    string = string.toLowerCase();
    
    switch (string) {
        case 'temperature':
            string=self.temperatureUnit;
            break;
        case 'humidity':
            string = '%';
            break;
        case 'co2':
            string = 'ppm';
            break;
        case 'noise':
            string = 'db';
            break;
       case 'pressure':
            string = 'mbar';
            break;
       case 'rain':
            string = 'mm';
            break;
    }
    
    return string;

};
