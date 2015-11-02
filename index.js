/*** Netatmo Z-Way module *******************************************

Version: 1.00
(c) CopyCatz, 2015
-----------------------------------------------------------------------------
Author: CopyCatz <bla@bla.com>
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
    this.token_expire_time  = undefined;
    this.last_token_time    = undefined;
    this.timer              = undefined;
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

    //var currentTime     = (new Date()).getTime();
    //var updateTime      = self.devices['temperature'].get('updateTime') * 1000;
    var intervalTime    = parseInt(self.config.interval) * 60 * 1000;
    
    self.timer = setInterval(function() {
        self.startFetch(self);
    }, intervalTime);
    
    //console.log('[Netatmo] Last update time '+updateTime);
    //if ((updateTime + intervalTime / 3) < currentTime) {
    self.startFetch(self);
    //}
};

Netatmo.prototype.stop = function () {
    var self = this;
    
    if (self.timer) {
        clearInterval(self.timer);
        self.timer = undefined;
    }
    
    if (typeof self.devices !== 'undefined') {
        _.each(self.devices,function(value, key) {
            self.controller.devices.remove(value.id);
        });
        self.devices = {};
    }
    
    Netatmo.super_.prototype.stop.call(this);
};

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

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

Netatmo.prototype.startFetch = function (instance) {

    var self = instance;
    var now_seconds = new Date().getTime() / 1000;
    if (this.token_expire_time==undefined||now_seconds-this.token_expire_time>this.last_token_time) {
        console.logJS('new token needed');
        self.fetchToken(instance);
    }
    else {
        console.logJS('token ok');
        self.fetchStationData(instance);
        
    }
}        
        

Netatmo.prototype.fetchToken = function (instance) {
    
    var self = instance;
    
    if (self.refresh_token == undefined) {
    
        http.request({
            url: "https://api.netatmo.net/oauth2/token",
            method: "POST",
            headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: {
                grant_type: 'password',
                client_id: this.client_id,
                client_secret: this.client_secret,
                username: this.username,
                password: this.password,
                scope: 'read_station'
            },
            async: true,
            success: function(response) {
                self.access_token = response.data.access_token;
                self.refresh_token = response.data.refresh_token;
                self.token_expire_time = response.data.expires_in;
                console.logJS('new token '+this.access_token);
                self.fetchStationData(instance);
            },
            error: function(response) {
                console.error("[Netatmo] Token fetch error");
                console.logJS(response);
                self.controller.addNotification(
                    "error", 
                    self.langFile.err_fetch_token, 
                    "module", 
                    "Netatmo"
                );
            }
        });
    }
    
    else {
        http.request({
            url: "https://api.netatmo.net/oauth2/token",
            method: "POST",
            headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: {
                grant_type: 'refresh_token',
                client_id: this.client_id,
                client_secret: this.client_secret,
                refresh_token: this.refresh_token
            },
            async: true,
            success: function(response) {
                self.access_token = response.data.access_token;
                self.refresh_token = response.data.refresh_token;
                self.token_expire_time = response.data.expires_in;
                self.fetchStationData(instance);
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
            }
        });        
    }
};    
    
Netatmo.prototype.fetchStationData = function (instance) {
    
    var self = instance;
    console.logJS('fetch using token '+self.access_token);

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
        }
    });
};

Netatmo.prototype.processResponse = function(instance,response) {
    
    console.log("[Netatmo] Update");
    var self = instance;
    if (self.numberOfDevices == undefined) {
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
            var moduleName = response.data.body.devices[dc].module_name;
            
            self.addDevice('temperature_'+dc,{
                metrics : {
                    probeTitle: self.langFile.temperature,
                    icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/temperature.png',
                    scaleTitle: this.temperatureUnit,
                    title: moduleName + ' ' + self.langFile.temperature
                }
            });
    
            self.addDevice('humidity_'+dc,{
                metrics : {
                    probeTitle: self.langFile.humidity,
                    icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/humidity.png',
                    scaleTitle: '%',
                    title: moduleName + ' ' + self.langFile.humidity
                }
            });

            self.addDevice('co2_'+dc,{
                metrics : {
                    probeTitle: self.langFile.co2,
                    icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/co2.png',
                    scaleTitle: 'ppm',
                    title: moduleName + ' ' + self.langFile.co2
                }
            });

            self.addDevice('pressure_'+dc,{
                metrics : {
                    probeTitle: self.langFile.pressure,
                    icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/pressure.png',
                    scaleTitle: 'mbar',
                    title: moduleName + ' ' + self.langFile.pressure
                }
            });
 
            self.addDevice('noise_'+dc,{
                metrics : {
                    probeTitle: self.langFile.noise,
                    icon: '/ZAutomation/api/v1/load/modulemedia/Netatmo/noise.png',
                    scaleTitle: 'db',
                    title: moduleName + ' ' + self.langFile.noise
                }
            });
            
            var numberOfModules = response.data.body.devices[dc].modules.length;
            
            for (mc = 0; mc < numberOfModules; mc++) {
                moduleName = response.data.body.devices[dc].modules[mc].module_name;
                var numberOfModuleVariables = response.data.body.devices[dc].modules[mc].data_type.length;
                for (mvc = 0; mvc < numberOfModuleVariables; mvc++) {
                    var variable=response.data.body.devices[dc].modules[mc].data_type[mvc];
                    var unit = self.getUnit(instance,variable);
                    if (variable == 'Rain') {
                        self.addDevice(variable + '_' + dc + '_' + mc,{
                            metrics : {
                                probeTitle: variable,
                                scaleTitle: unit,
                                title: moduleName + ' ' + variable + ' ('+self.langFile.current+')'
                            }
                        });
                        self.addDevice(variable + '1_' + dc + '_' + mc,{
                            metrics : {
                                probeTitle: variable,
                                scaleTitle: unit,
                                title: moduleName + ' ' + variable + ' ('+self.langFile.last1+')'
                            }
                        });
                        self.addDevice(variable + '24_' + dc + '_' + mc,{
                            metrics : {
                                probeTitle: variable,
                                scaleTitle: unit,
                                title: moduleName + ' ' + variable + ' ('+self.langFile.last24+')'
                            }
                        });
                    }
                    else {
                        self.addDevice(variable + '_' + dc + '_' + mc,{
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
        var temperature = response.data.body.devices[dc].dashboard_data.Temperature; // indoor temperature
        var humidity = response.data.body.devices[dc].dashboard_data.Humidity; // indoor temperature
        var co2 = response.data.body.devices[dc].dashboard_data.CO2; // indoor temperature
        var noise = response.data.body.devices[dc].dashboard_data.Noise; // indoor temperature
        var pressure = response.data.body.devices[dc].dashboard_data.Pressure; // indoor temperature

        self.devices['temperature_' + dc].set('metrics:level',temperature);
        self.devices['humidity_' + dc].set('metrics:level', humidity);
        self.devices['co2_' + dc].set('metrics:level', co2);
        self.devices['noise_' + dc].set('metrics:level', noise);
        self.devices['pressure_' + dc].set('metrics:level', pressure);
        
        // modules
        var numberOfModules = response.data.body.devices[dc].modules.length;
        for (mc = 0; mc < numberOfModules; mc++) {
            
            var numberOfModuleVariables = response.data.body.devices[dc].modules[mc].data_type.length;
            for (mvc = 0; mvc < numberOfModuleVariables; mvc++) {
                
                var variable=response.data.body.devices[dc].modules[mc].data_type[mvc];
                
                if (variable=='Rain') {

                    var icon = '/ZAutomation/api/v1/load/modulemedia/Netatmo/rain.png';

                    var value = response.data.body.devices[dc].modules[mc].dashboard_data[variable];
                    self.devices[variable + '_' + dc + '_' + mc].set('metrics:level', value);
                    self.devices[variable + '_' + dc + '_' + mc].set('metrics:icon', icon);
 
                    value = response.data.body.devices[dc].modules[mc].dashboard_data['sum_rain_1'];
                    self.devices[variable + '1_' + dc + '_' + mc].set('metrics:level', value);
                    self.devices[variable + '1_' + dc + '_' + mc].set('metrics:icon', icon);
 
                    value = response.data.body.devices[dc].modules[mc].dashboard_data['sum_rain_24'];
                    self.devices[variable + '24_' + dc + '_' + mc].set('metrics:level', value);
                    self.devices[variable + '24_' + dc + '_' + mc].set('metrics:icon', icon);
                
                }
                else {
                    
                    var value = response.data.body.devices[dc].modules[mc].dashboard_data[variable];
                    self.devices[variable + '_' + dc + '_' + mc].set('metrics:level', value);
                    var icon = '/ZAutomation/api/v1/load/modulemedia/Netatmo/'+variable.toLowerCase()+'.png';
                    self.devices[variable + '_' + dc + '_' + mc].set('metrics:icon', icon);
                
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
