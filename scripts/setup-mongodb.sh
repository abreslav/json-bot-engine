# https://docs.mongodb.com/manual/tutorial/install-mongodb-on-ubuntu/
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 2930ADAE8CAF5059EE73BB4B58712A2291FA4AD5
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu xenial/mongodb-org/3.6 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-3.6.list
sudo apt-get update
sudo apt-get install -y mongodb-org

# https://askubuntu.com/questions/61503/how-to-start-mongodb-server-on-system-start
sudo systemctl enable mongod.service

# https://docs.mongodb.com/master/tutorial/enable-authentication/
# use admin
# db.createUser(
#   {
#     user: "user-admin",
#     pwd: "PASS",
#     roles: [ { role: "userAdminAnyDatabase", db: "admin" } ]
#   }
# )

# https://stackoverflow.com/questions/6235808/how-can-i-restart-mongodb-with-auth-option-in-ubuntu-10-04
# https://docs.mongodb.com/master/reference/configuration-options/#security.authorization
#
# In /etc/mongod.conf
#   security:
#     authorization: enabled

sudo systemctl restart mongod