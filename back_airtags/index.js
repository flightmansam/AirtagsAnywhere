const express = require('express')
var haversine = require("haversine-distance");
const fs = require('fs');
var cors = require('cors');
const app = express()
const port = 3890
const HOURS_24_TO_MS = 1000 * 60 * 60 *24;
const watchMovements = new Set(); //any serial number here will be watched to see if it has left it's last reported location and will send a telegram message if it has
const alerts = new Set(); //a buffer to store telegram alerts for tracked items
const history = {};
/*
format of history:

"<device>"{"distances":[{"timeStamp":<val>, "dist_m":<val>}...], "lastReport":{<msg>}}, ...
*/

app.use(cors())

function getFindMyData() {
    try {
        const items_data = fs.readFileSync('Items.data', 'utf8');
        let parsed_data = JSON.parse(items_data);
        let items_filtered_data = parsed_data
            .filter(item => item.productType &&
            item.batteryStatus && item.address && item.address.formattedAddressLines &&
            item.location && item.location.latitude && 
            item.location.longitude && item.location.timeStamp && item.role && 
            item.serialNumber)
            .map(item => {
                return {
                    name: item.name,
                    battery: 100 - ( item.batteryStatus - 1) * 20,
                    address: item.address.formattedAddressLines.join(", "),
                    coords: [
                        item.location.latitude,
                        item.location.longitude
                    ],
                    distanceSinceLastReport:distanceSinceLastReport(item.serialNumber, {latitude:item.location.latitude, longitude:item.location.longitude}, item.location.timeStamp),
                    distance24Hours:distance24Hours(item.serialNumber),
                    date: new Date(item.location.timeStamp).toLocaleString(),
                    timeStamp: item.location.timeStamp,
                    emote: (item.role.emoji) ? item.role.emoji : "⚪️",
                    sn: item.serialNumber,
                    product: item.productType.type
                }
            });

        const devices_data = fs.readFileSync('Devices.data', 'utf8');
        parsed_data = JSON.parse(devices_data)
        let devices_filtered_data = parsed_data
        .filter(device => device.deviceModel && device.name && device.batteryLevel
            && device.address && device.address.formattedAddressLines && device.location && 
            device.location.latitude && device.location.longitude && device.location.timeStamp && 
            device.baUUID && (typeof device.isMac !== "undefined"))
        .map(device => {
            return {
                name: device.name,
                battery: Math.round(device.batteryLevel * 100),
                address: device.address.formattedAddressLines.join(", "),
                coords: [
                    device.location.latitude,
                    device.location.longitude
                ],
                distanceSinceLastReport:distanceSinceLastReport(device.baUUID, {latitude:device.location.latitude, longitude:device.location.longitude}, device.location.timeStamp),
                distance24Hours:distance24Hours(device.baUUID),
                date: new Date(device.location.timeStamp).toLocaleString(),
                timeStamp: device.location.timeStamp,
                emote: device.isMac ? "💻" : "📱",
                sn: device.baUUID,
                product: device.deviceModel
            }
        })

        const findMy_filtered_data = items_filtered_data.concat(devices_filtered_data);

        // if any of the data has moved AND is in watchMovements, add to an alert sending buffer
        findMy_filtered_data.forEach(air => {
            if (watchMovements.has(air.sn)) {
                if (air.distanceSinceLastReport > 100) alerts.add(air.sn)
            }
            
        })


        storeFindMyArray(findMy_filtered_data)

        // console.log(JSON.stringify(history, null, "\t"));

        return findMy_filtered_data
    } catch (err) {
        console.error(err);
    }
}

//store last report
async function storeFindMyArray(arr) {
    arr.map(device => {
        if (device.sn) {
            if (!(device.sn in history)) {
                history[device.sn] = {distances:[], lastReport:device}
            } else {
                history[device.sn].lastReport = device
            }
        }
    })
}

function distanceSinceLastReport(deviceSN, pointNow, pointTimeStamp){
    var distance = 0;
    if (deviceSN in history && history[deviceSN].lastReport){
        const lastReport = history[deviceSN].lastReport
        const pointLast = {latitude: lastReport.coords[0], longitude: lastReport.coords[1]}

        distance = haversine(pointNow, pointLast);
        if (distance < 100) distance = 0; // add a deadband

        if (lastReport.timeStamp != pointTimeStamp){
            // Only add new distances if the timestamp is diffferent on file.
            history[deviceSN].distances.push({timeStamp:lastReport.timeStamp, dist_m:distance})
        }
        
    }
    return distance

}

function distance24Hours(deviceSN){
    var distance = 0;
    if (deviceSN in history) {
        timeNow = Date.now()
        
        var distances24hrs = history[deviceSN].distances.filter(
            dist => (timeNow - dist.timeStamp) < HOURS_24_TO_MS
        )
        
        history[deviceSN].distances = distances24hrs;

        distances24hrs.map(dist => distance+=dist.dist_m)

    }

    return distance;
}

function sendAlerts(){
    if (alerts.size > 0) {
        console.log(alerts)
    }
}


// get the set of all the devices being watched
app.get('/watch', (req, res) => {
    res.json(Array.from(watchMovements))
});

// get the set of all the devices being watched
app.get('/watch/alerts', (req, res) => {
    res.json(Array.from(alerts))
});

// toggle device watching
app.get('/watch/toggle/:sn', (req, res) => {
    
    if (req.params['sn']) {
        var sn = req.params['sn']
        
        if (sn in history) {
            if (watchMovements.has(sn)) {
                watchMovements.delete(sn);
            } else {
                watchMovements.add(sn);
            }
            res.send("1")
            return
        }
        else {
            res.end()
        }
    } else {
        res.end()
    } 
})

app.get('/watch/clear', (req, res) => {
   watchMovements.clear()
    res.send("1")
})

app.get('/json', (req, res) => {
    res.json(getFindMyData())
})


app.listen(port, () => {
    console.log(`App listening on port ${port}`)
})

setInterval(getFindMyData, 1000 * 60 * 15);
setInterval(sendAlerts, 1000 * 60 * 5);