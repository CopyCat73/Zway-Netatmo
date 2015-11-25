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
        self.fetchStationData(self);
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
    
    self.numberOfDevices = undefined;
    Netatmo.super_.prototype.stop.call(this);
};


// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

Netatmo.prototype.addDevice = function(prefix,overlay) {

    var self = this;
    var deviceParams = {
        overlay: overlay,
        deviceId: "Netatmo_"+prefix+"_" + this.id,
        moduleId: prefix+"_"+this.id
    };
    deviceParams.overlay['deviceType'] = "sensorMultilevel";
    
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
            if(typeof self.tokentimer !== "undefined"){
                clearTimeout(self.tokentimer);
            }
            self.tokentimer = setInterval(function() {
                self.fetchRefreshToken();
            }, (response.data.expires_in-100) * 1000);
            self.fetchStationData(self);
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

    
Netatmo.prototype.fetchStationData = function (instance) {
    
    var self = instance;
    //console.logJS('fetch using token '+self.access_token);

    var url = "https://api.netatmo.com/api/getstationsdata?access_token="+this.access_token;
    
    http.request({
        url: url,
        async: true,
        success: function(response) { self.processResponse(instance,response) },
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
                self.fetchToken(instance);
            }
        }
    });
};

Netatmo.prototype.processResponse = function(instance,response) {
    
    console.log("[Netatmo] Update");
    var self = instance;
    
    var incomingNumberOfDevices = response.data.body.devices.length;
      
    if (self.numberOfDevices == undefined||self.numberOfDevices!=incomingNumberOfDevices) {
        // new or changed setting
        self.removeDevices();
        self.numberOfDevices = incomingNumberOfDevices;
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
            
            self.addDevice('temperature_'+deviceID,{
                metrics : {
                    probeTitle: self.langFile.temperature,
                    icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/temperature.png',
                    scaleTitle: this.temperatureUnit,
                    title: deviceName + ' ' + self.langFile.temperature
                }
            });
    
            self.addDevice('humidity_'+deviceID,{
                metrics : {
                    probeTitle: self.langFile.humidity,
                    icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/humidity.png',
                    scaleTitle: '%',
                    title: deviceName + ' ' + self.langFile.humidity
                }
            });

            self.addDevice('co2_'+deviceID,{
                metrics : {
                    probeTitle: self.langFile.co2,
                    icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/co2.png',
                    scaleTitle: 'ppm',
                    title: deviceName + ' ' + self.langFile.co2
                }
            });

            self.addDevice('pressure_'+deviceID,{
                metrics : {
                    probeTitle: self.langFile.pressure,
                    icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/pressure.png',
                    scaleTitle: 'mbar',
                    title: deviceName + ' ' + self.langFile.pressure
                }
            });
 
            self.addDevice('noise_'+deviceID,{
                metrics : {
                    probeTitle: self.langFile.noise,
                    icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/noise.png',
                    scaleTitle: 'db',
                    title: deviceName + ' ' + self.langFile.noise
                }
            });
            
            var numberOfModules = response.data.body.devices[dc].modules.length;
            
            for (mc = 0; mc < numberOfModules; mc++) {
                var moduleName = response.data.body.devices[dc].modules[mc].module_name;
                var moduleID = response.data.body.devices[dc].modules[mc]._id;
                var numberOfModuleVariables = response.data.body.devices[dc].modules[mc].data_type.length;
                for (mvc = 0; mvc < numberOfModuleVariables; mvc++) {
                    var variable=response.data.body.devices[dc].modules[mc].data_type[mvc];
                    var unit = self.getUnit(instance,variable);
                    if (variable == 'Rain') {
                        self.addDevice(variable + '_' + deviceID + '_' + moduleID,{
                            metrics : {
                                probeTitle: variable,
                                scaleTitle: unit,
                                title: moduleName + ' ' + variable + ' ('+self.langFile.current+')'
                            }
                        });
                        self.addDevice(variable + '1_' + deviceID + '_' + moduleID,{
                            metrics : {
                                probeTitle: variable,
                                scaleTitle: unit,
                                title: moduleName + ' ' + variable + ' ('+self.langFile.last1+')'
                            }
                        });
                        self.addDevice(variable + '24_' + deviceID + '_' + moduleID,{
                            metrics : {
                                probeTitle: variable,
                                scaleTitle: unit,
                                title: moduleName + ' ' + variable + ' ('+self.langFile.last24+')'
                            }
                        });
                    }
                    else {
                        self.addDevice(variable + '_' + deviceID + '_' + moduleID,{
                            metrics : {
                                probeTitle: variable,
                                scaleTitle: unit,
                                title: moduleName + ' ' + variable
                            }
                        });
                    }
                }
            }       
        }
    }
    
    for (dc = 0; dc < self.numberOfDevices; dc++) {
        
        // base stations
        var deviceID = response.data.body.devices[dc]._id;
        var temperature = response.data.body.devices[dc].dashboard_data.Temperature; // indoor temperature
        var humidity = response.data.body.devices[dc].dashboard_data.Humidity; // indoor temperature
        var co2 = response.data.body.devices[dc].dashboard_data.CO2; // indoor temperature
        var noise = response.data.body.devices[dc].dashboard_data.Noise; // indoor temperature
        var pressure = response.data.body.devices[dc].dashboard_data.Pressure; // indoor temperature

        self.devices['temperature_' + deviceID].set('metrics:level',temperature);
        self.devices['humidity_' + deviceID].set('metrics:level', humidity);
        self.devices['co2_' + deviceID].set('metrics:level', co2);
        self.devices['noise_' + deviceID].set('metrics:level', noise);
        self.devices['pressure_' + deviceID].set('metrics:level', pressure);
        
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
                    self.devices[variable + '_' + deviceID + '_' + moduleID].set('metrics:level', value);
                    self.devices[variable + '_' + deviceID + '_' + moduleID].set('metrics:icon', icon);
 
                    value = response.data.body.devices[dc].modules[mc].dashboard_data['sum_rain_1'];
                    self.devices[variable + '1_' + deviceID + '_' + moduleID].set('metrics:level', value);
                    self.devices[variable + '1_' + deviceID + '_' + moduleID].set('metrics:icon', icon);
 
                    value = response.data.body.devices[dc].modules[mc].dashboard_data['sum_rain_24'];
                    self.devices[variable + '24_' + deviceID + '_' + moduleID].set('metrics:level', value);
                    self.devices[variable + '24_' + deviceID + '_' + moduleID].set('metrics:icon', icon);
                
                }
                else {
                    
                    var value = response.data.body.devices[dc].modules[mc].dashboard_data[variable];
                    self.devices[variable + '_' + deviceID + '_' + moduleID].set('metrics:level', value);
                    var icon = '/ZAutomation/api/v1/load/modulemedia/Netatmo/'+variable.toLowerCase()+'.png';
                    self.devices[variable + '_' + deviceID + '_' + moduleID].set('metrics:icon', icon);
                
                }
            }
        }
    }
};

Netatmo.prototype.getUnit = function(instance,string) {
    
    var self = instance;
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
