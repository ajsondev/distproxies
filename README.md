

# distproxies
Compatible with all cloud providers, distproxies is a deployment toolkit to setup a highly scalable (and cheap) proxy backend for your scraping work or other nefarious activities. 
The setup/tools included in this project only pretain to deployment on AWS EC2, but with some adjustments it can easily run anywhere.
It's perfect if you are looking to provision your own secure SOCKS5/HTTP proxy pool without a ton of hassle (it should take two hours maximum).

## what & why
When web scraping and automating you are without question going to run into the issue of IP addresses and bot detection/rate limiting/etc. Commercial options are obscenely expensive (Luminati) so I made this toolkit to and have been using it with great success for almost a year now. 

## how
Proxies are machines that serve traffic. Now let's say I spin up 1500 of these machines… Cool, but still not good enough and I have to use some weird library to manage them so maybe there's a better way. 
We obviously need to separate the proxies/VMs, and the entity that provides them. I'll refer to the proxies as **workers**, and the machine you actually send a request to when you need a proxy as the **worker manager** (hopefully the naming is self-explanatory).

Workers: the machines who serve the proxies, their only function is to run socks and  http server, authenticate, and process network traffic. One of the great advantages of cloud-pricing schemes when it comes to pre-emptible VM instances is its unlikely you care if a connection gets dropped every so often - and you actually want your workers to terminate regardles (to renew their IP). Personally, I have them kill off every five minutes which gives a huge amount of IP space to work with.

Worker Manager: Where the workers check in once they intiailize. He will also run some constant health-checks on the pool to keep it clean so when hit with requests for MOAR proxies it can handle it.

### Prerequisites
- AWS Account (Free tier will work - but raise EC2 limates to have more fun if you can afford it)

- NPM Token, ability to publish private packages (you will need to publish your own if you want to do as little re-working as possible)

- Azure Account: I know, emberassing.. Only two things that depend on this: the `config.load()` call which loads the environment variables from an azure storage table, and a startup script that will live inside a blob that we'll need to curl later. There are plenty of other options that acccoomplish the same end- just know you'll need to tweak those portions of the scripts (I've commented whenever that applies).

What we're doing to do: package up this project, publish it via NPM, and use some cool scripts I've written to put everything in place. If this project gets any interest I am sure there's a much slicker way to get started/click-to-deploy but in any case getting your hands dirty will probably be a good learning experience.

### Installation/Setup
Clone this repo, npm install
Read the code carefully and cross-reference with the information here to make sure you understand what your about to do.

Project has 3 main components we care about:
`/workers/distproxies.js` - This is the worker (the guy who provides the proxy connection and then dies soon after). You'll see he's extending this other class `Worker` - its a base template I use for workers, surprise. Its a little abstract and hard but its function in our project is just to run this one file, literally. It gets required and executed by the worker bin (check `package.json` to see the binaries.

`/scripts/distproxies.js` - This is NOT the worker. this is the worker manager or proxy manager if that's easier to think about. He makes sure there's always healthy workers connected to serve as proxies upon request. Similarily, he is a binary.

We can provision our worker manager right away - we will need to know his hostname so we can set it in our env - so all of the workers know who to reach out to. His startup script is `worker-manager-ami.sh` and you can put him on any instance class you like.

## Scripts
This is where you'll most likely make any mistakes so be really careful to read the code carefully. 
`scripts/bake-worker` - Named because its function is to essentially 'bake' a image/AMI with our configuration for our worker (proxy provider), and then if specified- update an autoscaling group configuration with the new AMI to begin updating any active machines.

In practice I never have to update this even once but the script is pretty neat. Anyway... you will need to run this script the once to bake your image/AMI but most likely never again.


## The Result
We now have cheap, manageable distributed proxies! Below is a quick example to demonstrate how to actually call the worker manager and get a proxy in response; 
```js
const got = require('got');

async function getSOCKSProxy() {
  const response = await got('http://YOUR_WORKER_MANAGER_HOSTNAME/socks-proxy?pool=public', {
    method: 'GET',
    headers: {
      'auth-key': 'key',
    },
  });
  if (response.statusCode !== 200) {
    throw new Error('proxy response not 200');
  }
  const proxy = response.body;
  return proxy;
}

async function getHTTPProxy() {
  const response = await got('YOUR_WORKER_MANAGER_HOSTNAME/proxy?pool=public', {
    method: 'GET',
    headers: {
      'auth-key': 'key',
    },
  });
  if (response.statusCode !== 200) {
    throw new Error('proxy response not 200');
  }
  const proxy = response.body;
  return proxy;
}
```

As a reminder, the `?pool=public` portion of the url indicates the worker manager should give you a public proxy vs. a private proxy which would be only usable for other machines running on AWS. 

## Future Development
I haven't had much time to sink into this but I  would love to see the same idea applied across multiple cloud provides, improvement in the way connections are maintained between the worker and worker manager (I envision something akin to a 'sticky ELB' so connections won't get dropped on occasion or when the system is under heavy load.



## Contributing
Please!

## License
This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details

<!--stackedit_data:
eyJoaXN0b3J5IjpbLTI2MjU3MTMxOSw4MTA1NzgwMzldfQ==
-->